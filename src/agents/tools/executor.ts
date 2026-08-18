// ============================================================
// Ejecutor de Tools — La lógica real detrás de cada herramienta
//
// Cuando Claude decide usar una tool, este archivo la ejecuta:
// 1. Claude dice: "quiero usar check_availability para el 15 de febrero"
// 2. Este código consulta la DB y devuelve los horarios libres
// 3. Claude lee el resultado y le responde al paciente
//
// TODAS las consultas filtran por clinic_id (seguridad multi-tenant)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { calculateEndTime, formatForPatient, formatTimeForPatient, normalizePhone, getDayOfWeek } from '@/lib/utils/dates'
import { sendWhatsAppMessage, getClinicCreds } from '@/lib/whatsapp/client'
import { notifyStaffAppointmentCreated } from '@/lib/whatsapp/staff-appointment-notify'
import { syncClinicSheet } from '@/lib/google-sheets'
import { syncAppointmentToHis, syncCancelToHis } from '@/lib/integrations'
import { normalizeWorkingHours } from '@/lib/utils/working-hours'
import { getDoctorDaySchedule, dayKeyFromIndex, isRangeWithinSchedule, isFutureStart, fraseDiasQueAtiende } from '@/lib/calendar/schedule-check'
import { isSlotFree, BUSY_STATUSES, type BusyAppointment } from '@/lib/calendar/slot-availability'
import { generateTimeSlots } from '@/lib/calendar/time-slots'
import { normalizePaymentMode, decidePriceResponse, type PriceCtInput } from '@/lib/rules/price-tool-logic'
import type { Clinic, Doctor, WhatsAppConfig, VirtualConsultationConfig, WorkingBlock } from '@/types/database'
import { parseISO, addMinutes, format, isValid } from 'date-fns'
import { es } from 'date-fns/locale'
import { toZonedTime } from 'date-fns-tz'
import { mismoConvenioPorAlias, dijoParticular } from '@/lib/rules/convenio-aliases'
import { mensajeFechaBloqueada } from '@/lib/calendar/blocked-date-message'
import { resolverDisponibilidadDia } from '@/lib/calendar/day-availability'
import { indiceDiaSemanaCOT, traerFestivos } from '@/lib/calendar/fetch-day-availability'
import type { DoctorPin } from '@/lib/agent/doctor-pin'

const TIMEZONE = 'America/Bogota'
const SPANISH_DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Día de la semana en español para una fecha YYYY-MM-DD */
function spanishDayOfWeek(dateStr: string): string {
  return SPANISH_DAY_NAMES[toZonedTime(parseISO(`${dateStr}T12:00:00-05:00`), TIMEZONE).getDay()]
}

// ============================================================
// EL MÉDICO PINEADO — backstop duro
//
// Si la paciente nombró un médico, eso dejó de ser texto: es una restricción.
// El executor rechaza cualquier tool que apunte a otro `doctor_id`, igual que
// rechaza un tipo de consulta que no corresponde al médico.
//
// Existe porque el 2026-08-17 el modelo mandó doctor_id y consultation_type_id
// AMBOS del médico equivocado — coherentes entre sí, así que la validación que
// ya había no tenía contra qué contrastarlos. Esta sí: contra lo que pidió la
// paciente.
// ============================================================
function bloqueoPorPinDeMedico(
  doctorIdPedido: string | undefined | null,
  pin: DoctorPin | null | undefined,
): ToolResult | null {
  if (!pin?.doctor_id || !doctorIdPedido) return null
  if (doctorIdPedido === pin.doctor_id) return null
  return {
    success: false,
    error: `BLOCKED_BY_DOCTOR_PIN — La paciente pidió cita con ${pin.doctor_name}, no con otro médico.`,
    data: {
      pinned_doctor_id: pin.doctor_id,
      pinned_doctor_name: pin.doctor_name,
      requested_doctor_id: doctorIdPedido,
      instruction_for_llm:
        `La paciente pidió expresamente al ${pin.doctor_name}. NO consultes ni agendes con otro médico ` +
        `bajo ninguna circunstancia, ni siquiera si el servicio que pidió no existe con él o si otro ` +
        `médico tiene mejor horario. Volvé a llamar la tool con doctor_id="${pin.doctor_id}". ` +
        `Si lo que necesita no se puede con ${pin.doctor_name}, decíselo con claridad y escalá con ` +
        `escalate_to_human — nunca la cambies de médico por tu cuenta.`,
    },
  }
}

// Tipo para el resultado que devolvemos a Claude
interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Ejecuta una tool por nombre y devuelve el resultado para Claude
 * @param toolName - Nombre de la tool (ej: "check_availability")
 * @param input - Parámetros que Claude envió
 * @param clinicId - ID de la clínica (SIEMPRE se filtra por esto)
 * @param clinic - Datos de la clínica (para duración de citas, etc.)
 * @param doctor - Datos del doctor
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic,
  doctor: Doctor,
  /** El médico que la paciente nombró en la conversación, si nombró alguno.
   *  Restringe TODA tool que apunte a un médico. */
  pinMedico?: DoctorPin | null
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'check_availability':
        return (
          bloqueoPorPinDeMedico(input.doctor_id as string | undefined, pinMedico) ??
          (await checkAvailability(input, clinicId, clinic, doctor, pinMedico))
        )

      case 'create_appointment':
        return (
          bloqueoPorPinDeMedico(input.doctor_id as string | undefined, pinMedico) ??
          (await createAppointment(input, clinicId, clinic, pinMedico))
        )

      case 'get_patient_appointments':
        return await getPatientAppointments(input, clinicId)

      case 'cancel_appointment':
        return await cancelAppointment(input, clinicId)

      case 'reschedule_appointment':
        return await rescheduleAppointment(input, clinicId, clinic, pinMedico)

      case 'escalate_to_human':
        return await escalateToHuman(input, clinicId)

      case 'add_to_waitlist':
        return await addToWaitlist(input, clinicId)

      case 'calculate_date':
        return calculateDate(input)

      case 'check_eps_convenio':
        return await checkEpsConvenio(input, clinicId)

      case 'get_consultation_price':
        return await getConsultationPrice(input, clinicId)

      default:
        return { success: false, error: `Tool "${toolName}" no reconocida` }
    }
  } catch (error) {
    console.error(`[Tool:${toolName}] Error:`, error)
    // Prefijo INTERNAL_ERROR → el loop del agente lo corta y escala, NO lo
    // narra el LLM (que lo disfrazaría de negocio). Ver isTechnicalError.
    return {
      success: false,
      error: 'INTERNAL_ERROR — Ocurrió un error interno. Informa al paciente que hubo un problema y puede escribir "hablar con humano".',
    }
  }
}

// ============================================================
// CHECK AVAILABILITY — Buscar horarios disponibles
// ============================================================
// ⚠️ DOS VECES EL MISMO BUG EN ESTA FUNCIÓN, CON DIEZ DÍAS DE DIFERENCIA.
//
// El parámetro se llamaba `doctor` y era el médico PRINCIPAL de la clínica
// (doctors[0], ordenado por created_at). El médico que la paciente pidió llega
// por `input.doctor_id`. Dos variables para el mismo concepto, y la de nombre
// más natural era la equivocada.
//
//   2026-07-30 (18bd232) → los HORARIOS salían de `doctor.working_hours`.
//                          Se arregló: pasaron a `targetDoctor`.
//   2026-08-09           → el NOMBRE seguía saliendo de `doctor.name`, en TRES
//                          ramas. Una paciente pidió cita con su ginecólogo de
//                          8 años y el agente le respondió con la disponibilidad
//                          rotulada con el nombre de otra médica.
//
// El arreglo de julio ya traía `name` en el select de targetDoctor: el dato
// correcto estaba ahí, sin usar, al lado de la línea que leía el equivocado.
// Y en la misma función había ramas que YA resolvían bien (135, 147) junto a
// otras que no. Nadie eligió mal: eligió la variable que tenía más a mano.
//
// Por eso ahora: el médico se resuelve UNA vez, arriba, y de ahí para abajo
// `medico` es la única fuente. El default se llama `doctorPorDefecto` para que
// `doctorPorDefecto.name` se lea mal a simple vista — que es todo el punto.
async function checkAvailability(
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic,
  doctorPorDefecto: Doctor,
  pinMedico?: DoctorPin | null
): Promise<ToolResult> {
  // 🔴 ¿LA CLÍNICA ESTÁ OPERANDO HOY? Va antes que cualquier otra cosa.
  //
  // Una paciente preguntó "¿Está abierta Algia para el control?" y el agente
  // contestó "Sí, Algia está abierta, atiende hasta las 6:00 PM" en plena
  // contingencia por sismo. Lo dedujo de working_hours, que dice a qué hora abre
  // CUANDO abre — no si hoy está abierta.
  //
  // Corte determinista, como el de convenio_no_reconocido: el modelo no puede
  // afirmar que la clínica atiende, y acá directamente no llega a calcular nada.
  const estadoOperativo = (clinic as { operational_status?: string | null }).operational_status
  if (estadoOperativo && estadoOperativo !== 'operando') {
    const msgClinica = (clinic as { operational_status_message?: string | null }).operational_status_message
    return {
      success: false,
      error: `CLINICA_NO_OPERATIVA ${estadoOperativo}`,
      data: {
        estado: estadoOperativo,
        message_for_patient: msgClinica?.trim()
          || 'En este momento el consultorio no está atendiendo con normalidad. Ya le avisé al equipo para que se comunique contigo.',
        instruction_for_llm: 'La clínica NO está operando. NO agendes, NO ofrezcas horarios y NO afirmes que está abierta bajo ninguna circunstancia.',
      },
    }
  }

  const preferredDate = input.preferred_date as string | undefined
  // ÚNICO uso de `doctorPorDefecto` en toda la función: el fallback cuando el
  // modelo no manda doctor_id. Después de esta línea no se vuelve a tocar.
  // Con pin puesto, el default de la clínica NO aplica: si el modelo omite
  // doctor_id, el médico es el que pidió la paciente. Sin esta línea el pin se
  // evadía simplemente no mandando el argumento.
  const doctorId = (input.doctor_id as string) || pinMedico?.doctor_id || doctorPorDefecto.id

  // El médico PEDIDO. De acá salen el nombre, los horarios y el estado de la
  // agenda — no hay otra fuente más abajo.
  const { data: medico } = await supabaseAdmin
    .from('doctors')
    .select('agenda_closed, agenda_closed_reason, agenda_closed_until, name, schedule_type, manual_availability_message, working_hours')
    .eq('id', doctorId)
    .eq('clinic_id', clinicId)
    .single()

  // Doctor con disponibilidad manual — no mostrar slots
  if (medico?.schedule_type === 'manual') {
    const manualMsg = medico.manual_availability_message
      ?? 'Este médico no tiene horario fijo. Recoge los datos del paciente y usa add_to_waitlist.'
    return {
      success: true,
      data: {
        available: false,
        schedule_type: 'manual',
        reason: manualMsg,
        doctor_name: medico.name,
        message: 'Este doctor tiene disponibilidad manual. NO muestres horarios. Muestra el mensaje del doctor al paciente, recoge nombre, tipo de consulta y preferencia de horario, y usa add_to_waitlist con preferred_schedule_notes.',
      },
    }
  }

  if (medico?.agenda_closed) {
    const untilText = medico.agenda_closed_until
      ? ` hasta el ${format(parseISO(medico.agenda_closed_until), "d 'de' MMMM", { locale: es })}`
      : ''

    // Si es vacaciones, usar mensaje personalizado si existe
    let closedMessage = `La agenda de ${medico.name} está cerrada${untilText}. ${medico.agenda_closed_reason ? `Motivo: ${medico.agenda_closed_reason}. ` : ''}No se pueden agendar citas con este doctor en este momento.`

    if (medico.agenda_closed_reason === 'Vacaciones') {
      const config = clinic.whatsapp_config as Record<string, unknown> | null
      const vacationMsg = config?.vacation_message as string | undefined
      if (vacationMsg) {
        closedMessage = vacationMsg
          .replace(/\[fecha\]/gi, medico.agenda_closed_until
            ? format(parseISO(medico.agenda_closed_until), "d 'de' MMMM", { locale: es })
            : 'pronto')
      }
      closedMessage += ' ¿Te agendamos para cuando regresemos?'
    }

    return {
      success: true,
      data: {
        available: false,
        reason: closedMessage,
        agenda_closed: true,
      },
    }
  }

  // Si no dan fecha, usar hoy
  const dateStr = preferredDate ?? format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd')
  // Anclar al mediodía COT para evitar TZ shift: parseISO('YYYY-MM-DD') produce midnight UTC,
  // que en Vercel (TZ=UTC) al pasar por toZonedTime+getDay() devuelve el día ANTERIOR en Bogotá.
  // Bug observado por Lady (Algia): "lunes" terminaba leyendo config de domingo → "no atiende".
  const date = parseISO(`${dateStr}T12:00:00-05:00`)

  if (!isValid(date)) {
    return { success: false, error: 'Fecha no válida. Formato esperado: YYYY-MM-DD' }
  }

  // Verificar fechas bloqueadas (doctor-specific + clinic-wide)
  const { data: blockedRows } = await supabaseAdmin
    .from('blocked_dates')
    .select('id, doctor_id, reason')
    .eq('clinic_id', clinicId)
    .lte('start_date', dateStr)
    .gte('end_date', dateStr)
    .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
    .limit(1)

  if (blockedRows && blockedRows.length > 0) {
    const blocked = blockedRows[0]
    const blockedBy = blocked.doctor_id ? 'doctor' : 'clinic'
    const dow = spanishDayOfWeek(dateStr)
    return {
      success: true,
      data: {
        available: false,
        blocked: true,
        blockedBy,
        date: dateStr,
        dayOfWeek: dow,
        reason: mensajeFechaBloqueada({
          nombreMedico: medico?.name,
          bloqueadoPor: blockedBy,
          diaSemana: dow,
          motivo: blocked.reason,
        }),
      },
    }
  }

  // ¿Es festivo nacional? Va acá, después de blocked_dates y antes de las reglas
  // de anticipación: no tiene sentido calcular horarios de un día en que el país
  // no trabaja.
  //
  // Omuwan no sabía de festivos y el agente ofrecía cita el 17 de agosto. Lo
  // descubrimos porque una paciente se lo dijo en el chat: "el lunes es festivo".
  const festivosDelDia = await traerFestivos(clinicId, dateStr, dateStr)
  const nombreFestivo = festivosDelDia.get(dateStr)
  if (nombreFestivo) {
    return {
      success: true,
      data: {
        available: false,
        blocked: true,
        blockedBy: 'festivo',
        date: dateStr,
        dayOfWeek: spanishDayOfWeek(dateStr),
        // El nombre va en el mensaje: "no hay atención" a secas suena a error del
        // sistema, y la paciente vuelve a preguntar.
        reason: `El ${spanishDayOfWeek(dateStr)} ${dateStr} es festivo (${nombreFestivo}) y el consultorio no atiende. Decíselo a la paciente NOMBRANDO el festivo y ofrecé otra fecha con check_availability.`,
      },
    }
  }

  // Verificar reglas de anticipación de la clínica
  const now = toZonedTime(new Date(), TIMEZONE)
  const minAdvanceHours = clinic.min_booking_advance_hours ?? 24
  const maxAdvanceDays = clinic.max_booking_advance_days ?? 60

  const earliestAllowed = addMinutes(now, minAdvanceHours * 60)
  const latestAllowed = addMinutes(now, maxAdvanceDays * 24 * 60)

  // La fecha solicitada como fin de día para comparar con el máximo
  const requestedDateEnd = parseISO(`${dateStr}T23:59:00-05:00`)
  const requestedDateStart = parseISO(`${dateStr}T00:00:00-05:00`)

  if (requestedDateEnd < earliestAllowed) {
    const earliestDateStr = format(earliestAllowed, 'yyyy-MM-dd')
    const earliestFormatted = format(earliestAllowed, "EEEE d 'de' MMMM", { locale: es })
    return {
      success: true,
      data: {
        available: false,
        date: dateStr,
        reason: minAdvanceHours > 0
          ? `Las citas se agendan con mínimo ${minAdvanceHours >= 24 ? `${Math.round(minAdvanceHours / 24)} día(s)` : `${minAdvanceHours} horas`} de anticipación. El primer día disponible es ${earliestFormatted}.`
          : 'No hay disponibilidad para esa fecha.',
        earliest_available_date: earliestDateStr,
      },
    }
  }

  if (requestedDateStart > latestAllowed) {
    const latestDateStr = format(latestAllowed, 'yyyy-MM-dd')
    const latestFormatted = format(latestAllowed, "EEEE d 'de' MMMM", { locale: es })
    return {
      success: true,
      data: {
        available: false,
        date: dateStr,
        reason: `Solo se pueden agendar citas hasta ${maxAdvanceDays} días en el futuro. La fecha máxima es ${latestFormatted}.`,
        latest_available_date: latestDateStr,
      },
    }
  }

  // Verificar config per-doctor desde whatsapp_config
  const waConfig = clinic.whatsapp_config as WhatsAppConfig | null
  const docConfig = waConfig?.doctors[doctorId]

  // ¿Este médico atiende distinto ESA fecha puntual? Se consulta acá, después de
  // los bloqueos: una excepción cambia las horas de un día que se atiende, nunca
  // abre un día cerrado.
  const { data: excFilas } = await supabaseAdmin
    .from('doctor_schedule_exceptions')
    .select('blocks, reason')
    .eq('clinic_id', clinicId).eq('doctor_id', doctorId)
    .eq('exception_date', dateStr)
    .limit(1)
  const excRaw = excFilas?.[0]
  const excepcionDelDia = excRaw && Array.isArray(excRaw.blocks) && excRaw.blocks.length > 0
    ? { blocks: excRaw.blocks as WorkingBlock[], reason: (excRaw.reason as string | null) ?? null }
    : null

  // Las franjas del día salen de la FUENTE ÚNICA que comparte con la agenda del
  // dashboard (lib/calendar/day-availability). Acá vivía una copia de la lógica
  // de precedencia —working_hours del médico > whatsapp_config > clínica, con el
  // corte del día explícitamente inactivo—, y la grilla del dashboard estaba a
  // punto de tener la suya. Dos implementaciones de "¿a qué hora atiende?" es
  // exactamente el bug que ya nos costó cinco veces.
  const dispDia = resolverDisponibilidadDia({
    fecha: dateStr,
    diaSemana: spanishDayOfWeek(dateStr),
    indiceDiaSemana: indiceDiaSemanaCOT(dateStr),
    medico: medico
      ? {
          nombre: medico.name,
          working_hours: medico.working_hours,
          // manual y agenda_closed ya se resolvieron arriba con sus mensajes
          // propios para el LLM; acá solo interesan las franjas.
          agenda_closed: false,
          agenda_closed_reason: null,
          agenda_closed_until: null,
          schedule_type: null,
          manual_availability_message: null,
        }
      : null,
    fechaBloqueada: null,   // ídem: ya cortó arriba
    festivo: null,          // ídem
    estadoClinica: null,    // ídem — cortó al principio de la función
    // La excepción NO cortó arriba: no cierra el día, le cambia las horas. Si
    // este médico atiende distinto esa fecha puntual, estas son sus franjas y
    // el horario semanal no se mira. Sin esto el agente ofrecería los horarios
    // de siempre en un día que la clínica cambió a mano.
    excepcion: excepcionDelDia,
    configWhatsApp: docConfig ? { days: docConfig.days, start: docConfig.start, end: docConfig.end } : null,
    horarioClinica: clinic.working_hours,
  })
  const dayBlocks: WorkingBlock[] = dispDia.franjas

  if (!dispDia.atiende) {
    const dow = spanishDayOfWeek(dateStr)
    // LOS DÍAS QUE SÍ ATIENDE VAN EN LA RESPUESTA.
    //
    // Sin esto, el 2026-08-18 el agente contestó "no atiende los jueves.
    // Atiende lunes, martes, miércoles, viernes y sábado" sobre un médico que
    // atiende lunes, miércoles y viernes: el prompt le pedía nombrar los días
    // y ninguna tool se los daba, así que rellenó el hueco con "todos menos el
    // que preguntó". Una paciente puede presentarse un sábado con la clínica
    // cerrada.
    const diasReales = fraseDiasQueAtiende(medico?.working_hours ?? null)
    return {
      success: true,
      data: {
        available: false,
        date: dateStr,
        dayOfWeek: dow,
        doctor_name: medico?.name ?? null,
        dias_que_atiende: diasReales || null,
        reason: diasReales
          ? `El doctor no atiende ese día (${dow}). Atiende ${diasReales}.`
          : `El doctor no atiende ese día (${dow}).`,
        instruction_for_llm: diasReales
          ? `Decile a la paciente EXACTAMENTE estos días y NINGÚN otro: ${diasReales}. No agregues días que no estén en esa lista ni deduzcas cuáles son por descarte.`
          : 'Este médico no tiene días de atención cargados. NO inventes ninguno: decile que lo verificás con el consultorio y usá escalate_to_human.',
      },
    }
  }

  // Para acotar el query a citas existentes, usar el rango total del día (primer start ↔ último end)
  const dayStartTime = dayBlocks[0].start
  const dayEndTime = dayBlocks[dayBlocks.length - 1].end
  const dayStart = `${dateStr}T${dayStartTime}:00-05:00`
  const dayEnd = `${dateStr}T${dayEndTime}:00-05:00`

  const { data: existingAppointments, error } = await supabaseAdmin
    .from('appointments')
    .select('starts_at, ends_at, status')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', [...BUSY_STATUSES])
    .gte('starts_at', dayStart)
    .lte('starts_at', dayEnd)
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[check_availability] Error DB:', error)
    return { success: false, error: 'INTERNAL_ERROR — Error consultando disponibilidad' }
  }

  // Si se proporcionó consultation_type_id, usar su duración
  const consultationTypeId = input.consultation_type_id as string | undefined
  let duration = docConfig?.duration ?? waConfig?.appointment.default_duration ?? clinic.consultation_duration_minutes

  if (consultationTypeId) {
    const { data: ctData } = await supabaseAdmin
      .from('consultation_types')
      .select('duration_minutes, doctor_id')
      .eq('id', consultationTypeId)
      .eq('clinic_id', clinicId)
      .single()
    if (ctData) {
      // Warn if consultation type doesn't match the doctor
      if (ctData.doctor_id && ctData.doctor_id !== doctorId) {
        return { success: false, error: 'Ese tipo de consulta no corresponde a este doctor. Pregunta al paciente qué tipo de consulta necesita con este doctor.' }
      }
      duration = ctData.duration_minutes
    }
  }

  // Filtrar por franjas preferidas del tipo de consulta (si las tiene)
  let effectiveBlocks = dayBlocks
  let hasPreferredSchedule = false

  if (consultationTypeId) {
    const dayNum = toZonedTime(parseISO(`${dateStr}T12:00:00-05:00`), TIMEZONE).getDay()
    const { data: ctSchedules } = await supabaseAdmin
      .from('consultation_type_schedules')
      .select('start_time, end_time')
      .eq('consultation_type_id', consultationTypeId)
      .eq('day_of_week', dayNum)

    if (ctSchedules && ctSchedules.length > 0) {
      hasPreferredSchedule = true
      // Intersectar franjas preferidas con bloques del doctor
      const intersected: typeof dayBlocks = []
      for (const sched of ctSchedules) {
        const schedStart = (sched.start_time as string).slice(0, 5) // "09:00:00" → "09:00"
        const schedEnd = (sched.end_time as string).slice(0, 5)
        for (const block of dayBlocks) {
          const iStart = block.start > schedStart ? block.start : schedStart
          const iEnd = block.end < schedEnd ? block.end : schedEnd
          if (iStart < iEnd) intersected.push({ start: iStart, end: iEnd })
        }
      }
      effectiveBlocks = intersected
      console.log(`[check_availability] Filtering by consultation_type_schedule: type=${consultationTypeId} day=${dayNum} → ${intersected.length} intersected blocks`)
    }
  }

  // Generar slots iterando sobre todos los bloques efectivos
  const allSlots = effectiveBlocks.flatMap((b) => generateTimeSlots(dateStr, b.start, b.end, duration))

  // Filtrar ocupados con SOLAPAMIENTO real (función compartida con
  // create_appointment) — antes se comparaba starts_at por string y nunca
  // matcheaba, así que nunca restaba ninguna cita.
  const earliestAllowedISO = earliestAllowed.toISOString()
  const busy = (existingAppointments ?? []) as BusyAppointment[]
  const availableSlots = allSlots.filter((slot) => {
    const slotEnd = new Date(Date.parse(slot.utc) + duration * 60000).toISOString()
    if (!isSlotFree(slot.utc, slotEnd, busy)) return false
    // Excluir slots demasiado próximos según min_booking_advance_hours
    if (slot.utc < earliestAllowedISO) return false
    return true
  })

  if (availableSlots.length === 0) {
    return {
      success: true,
      data: {
        available: false,
        date: dateStr,
        dayOfWeek: spanishDayOfWeek(dateStr),
        reason: hasPreferredSchedule
          ? 'preferred_schedule_full'
          : 'No hay horarios disponibles para esta fecha',
        suggestion: hasPreferredSchedule
          ? 'Este tipo de consulta tiene franjas horarias específicas y están llenas. Escala a la secretaria con escalate_to_human.'
          : 'Puedes ofrecer al paciente unirse a la lista de espera o probar otro día',
      },
    }
  }

  return {
    success: true,
    data: {
      available: true,
      date: dateStr,
      dayOfWeek: spanishDayOfWeek(dateStr),
      doctor_name: medico?.name ?? '',
      slots: availableSlots.map((s) => ({
        time: s.display,
        starts_at: s.utc,
      })),
      total_available: availableSlots.length,
    },
  }
}

// generateTimeSlots vive en @/lib/calendar/time-slots (módulo puro, testeable).
// Importado arriba.

// ============================================================
// CREATE APPOINTMENT — Crear cita nueva
// ============================================================
async function createAppointment(
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic,
  pinMedico?: DoctorPin | null
): Promise<ToolResult> {
  const doctorId = input.doctor_id as string
  const patientName = input.patient_name as string
  const patientPhone = normalizePhone(input.patient_phone as string)
  const startsAt = input.starts_at as string
  const reason = (input.reason as string) ?? null
  const dateOfBirth = (input.date_of_birth as string) ?? null
  const documentType = (input.document_type as string) ?? null
  const documentNumber = (input.document_number as string) ?? null
  const patientEmail = (input.patient_email as string) ?? null
  const patientEps = (input.patient_eps as string) ?? null
  const procedureEntity = (input.procedure_entity as string) ?? null
  let consultationTypeId: string | null = (input.consultation_type_id as string | undefined) ?? null
  const modality = (input.modality as string) ?? 'presencial'
  const freeTextReason = (input.free_text_reason as string) ?? null
  // Ahora son las PALABRAS LITERALES de la paciente (el LLM transcribe, el
  // código clasifica de forma determinista más abajo). Antes era la etiqueta
  // yes/no/ambiguous que producía el LLM (y a veces mal — F3).
  const patientConditionAnswers = (input.patient_condition_answers as Record<string, string> | undefined) ?? {}

  // BACKSTOP — NUNCA agendar sin tipo de consulta. Si no vino, resolver el ÚNICO
  // tipo agendable por WhatsApp del médico y ESCRIBIRLO; si hay varios (o ninguno),
  // BLOQUEAR. Una cita con consultation_type_id null queda ROTA: sin precio, sin
  // duración real, sin reglas del tipo (edad/condición/entrega-resultados/auth),
  // sin dato de reporte. Gemelo del fix de identidad: el otro campo que el schema
  // no exige y que el agente podría omitir (permitir null "porque hay uno solo"
  // deja la fila igual de rota).
  if (!consultationTypeId) {
    const { data: docTypes } = await supabaseAdmin
      .from('consultation_types')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorId)
      .eq('is_active', true)
      .eq('bookable_via_whatsapp', true)
    const types = (docTypes ?? []) as { id: string; name: string }[]
    if (types.length === 1) {
      consultationTypeId = types[0].id   // resuelto → se escribe, NUNCA null
    } else {
      return {
        success: false,
        error: 'BLOCKED_MISSING_CONSULTATION_TYPE',
        data: {
          outcome: 'missing_consultation_type',
          message_for_patient: types.length === 0
            ? 'Necesito confirmar con el consultorio antes de agendar esta cita. Ya lo verifico.'
            : '¿Qué tipo de consulta necesitas? Así agendo con la duración y el valor correctos.',
          instruction_for_llm: types.length === 0
            ? 'El médico no tiene tipos agendables por WhatsApp: NO agendes. Escalá con escalate_to_human.'
            : `NO agendes sin consultation_type_id. El médico tiene ${types.length} tipos agendables: ${types.map((t) => t.name).join(', ')}. Preguntá al paciente cuál necesita y volvé a llamar create_appointment con el consultation_type_id correcto.`,
        },
      }
    }
  }

  // ¿EL SERVICIO ES DE ESTE MÉDICO? Va ANTES de todas las reglas del tipo.
  //
  // Estaba al final, justo antes del insert, y ese orden tenía un costo que se
  // vio en producción: a Lina Marcela el agente le preguntó "¿estás embarazada?"
  // —una regla del servicio de OTRO médico— cuando ella había pedido a Jorge
  // Darío. Se le hicieron preguntas de un servicio que nunca le correspondía.
  //
  // Si el tipo no es de este médico, ninguna de sus reglas aplica: se corta acá.
  if (consultationTypeId) {
    const { data: ctDueño } = await supabaseAdmin
      .from('consultation_types')
      .select('doctor_id')
      .eq('id', consultationTypeId)
      .eq('clinic_id', clinicId)
      .maybeSingle()

    if (ctDueño?.doctor_id && ctDueño.doctor_id !== doctorId) {
      // CAPA 2 — con pin puesto no hay "cambiémosla de médico": se le devuelve
      // al modelo el catálogo REAL del médico que pidió la paciente y, si nada
      // encaja, escala. Ver appointment-agent (corte BLOCKED_BY_DOCTOR_PIN_SERVICE).
      if (pinMedico?.doctor_id) {
        const { data: suyos } = await supabaseAdmin
          .from('consultation_types')
          .select('id, name')
          .eq('clinic_id', clinicId)
          .eq('doctor_id', pinMedico.doctor_id)
          .eq('is_active', true)
          .eq('bookable_via_whatsapp', true)

        // Dedup por NOMBRE: el convenio es dimensión de fila, así que el mismo
        // servicio aparece N veces (una por eps_name). Sin esto, una médica con
        // 27 filas y 9 servicios reales le devuelve al modelo una lista ilegible.
        const vistos = new Set<string>()
        const lista = (suyos ?? [])
          .filter((c) => { const k = (c.name as string).toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true })
          .map((c) => `${c.name} (tipo_id: ${c.id})`)

        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinicId,
          action: 'servicio_no_existe_con_medico',
          actor_type: 'agent',
          target_type: 'consultation_type',
          target_id: consultationTypeId,
          details: { pinned_doctor_id: pinMedico.doctor_id, pinned_doctor_name: pinMedico.doctor_name, requested_doctor_id: doctorId },
        }).then(() => {}, () => {})

        return {
          success: false,
          error: 'BLOCKED_BY_DOCTOR_PIN_SERVICE — El tipo de consulta pedido no existe bajo el médico que pidió la paciente.',
          data: {
            pinned_doctor_name: pinMedico.doctor_name,
            servicios_disponibles_con_ese_medico: lista,
            instruction_for_llm: lista.length > 0
              ? `Ese servicio NO lo presta ${pinMedico.doctor_name}. NO lo agendes con otro médico. ` +
                `Estos son los ÚNICOS servicios que él/ella sí atiende: ${lista.join(' · ')}. ` +
                `Si alguno es lo que la paciente necesita, confirmáselo y agendá ese. Si ninguno lo es, ` +
                `decíselo con honestidad ("ese servicio no lo atiende ${pinMedico.doctor_name}") y llamá ` +
                `escalate_to_human para que una persona del consultorio la oriente.`
              : `${pinMedico.doctor_name} no tiene servicios agendables por WhatsApp. Decíselo a la ` +
                `paciente y llamá escalate_to_human. NO la agendes con otro médico.`,
          },
        }
      }
      return { success: false, error: 'Ese tipo de consulta no corresponde al doctor seleccionado. Pregunta al paciente qué tipo de consulta necesita con este doctor.' }
    }
  }

  // Validar motivo libre si el tipo lo requiere
  if (consultationTypeId) {
    const { data: ctCheck } = await supabaseAdmin
      .from('consultation_types')
      .select('requires_free_text_reason')
      .eq('id', consultationTypeId)
      .eq('clinic_id', clinicId)
      .single()
    if (ctCheck?.requires_free_text_reason && !freeTextReason?.trim()) {
      return { success: false, error: 'Este tipo de consulta requiere motivo escrito del paciente. Pregunta primero al paciente cuál es su motivo o diagnóstico.' }
    }
  }

  // Bloque 1 (escalate_human) — CHECK DURO en defense in depth.
  //
  // El system prompt YA le dice al agente "no agendes tipos marcados 🚨"
  // (capa A). Este chequeo es la segunda capa: si el LLM ignora la regla
  // del prompt (drift, edge case, prompt injection, etc.) Y aún así llama
  // create_appointment, acá lo bloqueamos físicamente y registramos el
  // intento en audit_log para detectar drift en producción.
  //
  // El error que devolvemos al LLM en el turno siguiente lo obliga a
  // escalar (escalate_to_human).
  if (consultationTypeId) {
    const { data: escalateRule } = await supabaseAdmin
      .from('consultation_type_rules')
      .select('id, message')
      .eq('consultation_type_id', consultationTypeId)
      .eq('rule_type', 'escalate_human')
      .eq('active', true)
      .maybeSingle()

    if (escalateRule) {
      // Registrar: el LLM intentó agendar a pesar del marcador 🚨 en el prompt.
      // Esto vale oro para detectar drift del LLM en producción.
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'create_appointment_blocked_by_rule',
        actor_type: 'agent',
        target_type: 'consultation_type',
        target_id: consultationTypeId,
        details: {
          rule_type: 'escalate_human',
          rule_id: escalateRule.id,
          llm_attempted_anyway: true,
          patient_phone: patientPhone,
        },
      })

      const defaultMessage =
        'Tu solicitud requiere validación con un asesor del consultorio antes de agendar. Te paso con el equipo y te contactan.'

      return {
        success: false,
        error: 'BLOCKED_BY_RULE_ESCALATE_HUMAN',
        data: {
          rule_type: 'escalate_human',
          must_escalate: true,
          message_for_patient: escalateRule.message ?? defaultMessage,
          // El LLM debe ahora llamar escalate_to_human con esta razón
          escalate_reason: 'Servicio configurado por la clínica como "escalar siempre a humano" — requiere validación del staff antes de agendar.',
          escalate_urgency: 'medium',
        },
      }
    }
  }

  // Bloque 2 (age_limit) — CHECK DURO en defense in depth.
  //
  // El system prompt YA le dice al agente "tipos marcados 👶 EDAD requieren
  // verificar edad antes de agendar" (capa A). Este chequeo recalcula la
  // edad desde date_of_birth y rechaza si está fuera de rango — sin importar
  // qué decida el LLM. Para edad desconocida (DOB null/inválido), se fuerza
  // derivación a humano (safe default: la clínica revisa antes de agendar).
  if (consultationTypeId) {
    const { data: ageRule } = await supabaseAdmin
      .from('consultation_type_rules')
      .select('id, condition_config')
      .eq('consultation_type_id', consultationTypeId)
      .eq('rule_type', 'age_limit')
      .eq('active', true)
      .maybeSingle()

    if (ageRule) {
      const { AgeLimitConfigSchema, evaluateAgeLimit } = await import('@/lib/rules/age-limit-config')
      const { calculateAgeFromBirthDate } = await import('@/lib/utils/age')
      const parsed = AgeLimitConfigSchema.safeParse(ageRule.condition_config)

      if (parsed.success) {
        // Si no llegó fecha en el input, intentar leerla del paciente existente
        let dobToUse: string | null = dateOfBirth
        if (!dobToUse) {
          const { data: existingPatient } = await supabaseAdmin
            .from('patients')
            .select('date_of_birth')
            .eq('clinic_id', clinicId)
            .eq('phone', patientPhone)
            .maybeSingle()
          dobToUse = (existingPatient?.date_of_birth as string | undefined) ?? null
        }

        const age = calculateAgeFromBirthDate(dobToUse)
        const config = parsed.data

        if (age === null) {
          // DOB ausente o inválido: forzar derivación al staff (safe default).
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinicId,
            action: 'create_appointment_blocked_by_rule',
            actor_type: 'agent',
            target_type: 'consultation_type',
            target_id: consultationTypeId,
            details: {
              rule_type: 'age_limit',
              rule_id: ageRule.id,
              outcome: 'age_unknown',
              dob_provided: dobToUse,
              llm_attempted_anyway: true,
              patient_phone: patientPhone,
            },
          })
          return {
            success: false,
            error: 'BLOCKED_BY_AGE_UNKNOWN',
            data: {
              rule_type: 'age_limit',
              outcome: 'age_unknown',
              must_escalate: true,
              message_for_patient:
                'Necesito tu fecha de nacimiento para confirmar el agendamiento de este servicio. Le aviso a un asesor del consultorio para que te contacte y complete el dato.',
              escalate_reason: 'Edad no validable — paciente no proporcionó fecha de nacimiento para servicio con regla de edad.',
              escalate_urgency: 'medium',
            },
          }
        }

        const evalResult = evaluateAgeLimit(age, config)
        if (evalResult) {
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinicId,
            action: 'create_appointment_blocked_by_rule',
            actor_type: 'agent',
            target_type: 'consultation_type',
            target_id: consultationTypeId,
            details: {
              rule_type: 'age_limit',
              rule_id: ageRule.id,
              outcome: evalResult.edge,
              action_taken: evalResult.action,
              age_calculated: age,
              dob_used: dobToUse,
              config_min: config.min ?? null,
              config_max: config.max ?? null,
              llm_attempted_anyway: true,
              patient_phone: patientPhone,
            },
          })

          if (evalResult.action === 'derivar_humano') {
            const edgeText = evalResult.edge === 'below_min'
              ? `menor a ${config.min} años`
              : `mayor a ${config.max} años`
            return {
              success: false,
              error: 'BLOCKED_BY_AGE_DERIVAR',
              data: {
                rule_type: 'age_limit',
                outcome: evalResult.edge,
                age_calculated: age,
                must_escalate: true,
                message_for_patient:
                  'Para este servicio en tu caso necesito que un asesor del consultorio lo confirme contigo. Ya les avisé y te contactan pronto.',
                escalate_reason: `Edad fuera de rango configurado (paciente ${age} años, ${edgeText}). Requiere revisión del staff.`,
                escalate_urgency: 'medium',
              },
            }
          }

          // action === 'rechazar': no escalar, comunicar al paciente que no se realiza.
          // Tono cálido — especialmente "below_min" suele ser un menor de edad.
          const messageRechazar = evalResult.edge === 'below_min'
            ? `Lo siento mucho, esta consulta se realiza desde los ${config.min} años, así que en este momento no podemos agendarte. Si tu mamá, papá o un familiar adulto quiere agendar para ti, lo coordinamos con ellos. ¿Te puedo ayudar con algo más?`
            : `Lo siento mucho, esta consulta se atiende hasta los ${config.max} años, así que en este caso no podemos agendarte por este canal. Te recomiendo contactar directamente al consultorio para que te orienten al especialista adecuado. ¿Te puedo ayudar con algo más?`
          return {
            success: false,
            error: 'BLOCKED_BY_AGE_RECHAZAR',
            data: {
              rule_type: 'age_limit',
              outcome: evalResult.edge,
              age_calculated: age,
              must_escalate: false,
              message_for_patient: messageRechazar,
            },
          }
        }
        // Edad dentro de rango → seguir flujo normal.
      }
    }
  }

  // Bloque 3 (patient_condition) — CHECK DURO híbrido.
  //
  // Defense in depth con un giro: el código NO puede verificar respuestas
  // como "¿estás embarazada?" (viven en la conversación). Pero SÍ puede
  // forzar que el agente haya OBTENIDO una respuesta antes de agendar.
  //
  // El LLM debe pasar patient_condition_answers con una entry por cada
  // regla activa. Si falta alguna → BLOCKED_CONDITION_NOT_ASKED (forza
  // al LLM a preguntar). Si está pero coincide con trigger_answer →
  // BLOCKED_BY_CONDITION_*. Si es 'ambiguous' → safe default = derivar.
  if (consultationTypeId) {
    const { data: conditionRules } = await supabaseAdmin
      .from('consultation_type_rules')
      .select('id, condition_config')
      .eq('consultation_type_id', consultationTypeId)
      .eq('rule_type', 'patient_condition')
      .eq('active', true)

    if (conditionRules && conditionRules.length > 0) {
      const { PatientConditionConfigSchema, evaluatePatientCondition } = await import('@/lib/rules/patient-condition-config')
      const { classifyYesNo, classifyChoice } = await import('@/lib/rules/patient-answer-classifier')

      // Check 1: ¿Faltan respuestas?
      const missing: Array<{ ruleId: string; question: string }> = []
      for (const row of conditionRules) {
        const r = row as { id: string; condition_config: unknown }
        const parsed = PatientConditionConfigSchema.safeParse(r.condition_config)
        if (!parsed.success) continue // config corrupto, skip (no debería pasar — Zod en write)
        if (!(r.id in patientConditionAnswers)) {
          missing.push({ ruleId: r.id, question: parsed.data.question })
        }
      }

      if (missing.length > 0) {
        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinicId,
          action: 'create_appointment_blocked_by_rule',
          actor_type: 'agent',
          target_type: 'consultation_type',
          target_id: consultationTypeId,
          details: {
            rule_type: 'patient_condition',
            outcome: 'not_asked',
            missing_rule_ids: missing.map((m) => m.ruleId),
            llm_attempted_anyway: true,
            patient_phone: patientPhone,
          },
        })
        return {
          success: false,
          error: 'BLOCKED_CONDITION_NOT_ASKED',
          data: {
            rule_type: 'patient_condition',
            outcome: 'not_asked',
            missing_questions: missing,
            instruction_for_llm:
              'Tenés que hacerle al paciente las preguntas faltantes antes de agendar. ' +
              'En tu próxima respuesta hacele esas preguntas en un solo mensaje, esperá la respuesta, ' +
              'y volvé a llamar create_appointment con patient_condition_answers incluyendo TODAS las reglas.',
          },
        }
      }

      // Check 2: evaluar cada respuesta. Si alguna dispara o es ambigua → bloquear.
      for (const row of conditionRules) {
        const r = row as { id: string; condition_config: unknown }
        const parsed = PatientConditionConfigSchema.safeParse(r.condition_config)
        if (!parsed.success) continue
        const config = parsed.data
        // El código clasifica la respuesta LITERAL (determinista), no confía
        // en una etiqueta del LLM. Safe default = ambiguous → deriva.
        const literalAnswer = patientConditionAnswers[r.id] ?? ''
        const classification = config.question_type === 'yes_no'
          ? classifyYesNo(literalAnswer)
          : classifyChoice(literalAnswer, config.options)
        const evalRes = evaluatePatientCondition(classification, config)

        // LOG de recolección de frases (SIEMPRE, apt incluido): la respuesta
        // LITERAL + la clasificación que produjo el código. En 2 semanas esto
        // da la lista real de frases para que una doctora valide los bordes —
        // no una lista inventada. Sin patient_phone: solo interesa la frase.
        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinicId,
          action: 'patient_condition_answer',
          actor_type: 'system',
          target_type: 'consultation_type',
          target_id: consultationTypeId,
          details: {
            rule_id: r.id,
            question: config.question,
            question_type: config.question_type,
            literal_answer: literalAnswer,
            classification,
            outcome: evalRes.outcome,
          },
        })

        if (evalRes.outcome === 'apt') continue

        // Logging detallado para auditoría. Distinguir yes_no vs multiple_choice
        // para que el audit registre lo más relevante de cada tipo.
        const auditDetails: Record<string, unknown> = {
          rule_type: 'patient_condition',
          rule_id: r.id,
          question_type: config.question_type,
          question: config.question,
          literal_answer: literalAnswer,
          classification,
          outcome: evalRes.outcome,
          action_taken: evalRes.action,
          llm_attempted_anyway: true,
          patient_phone: patientPhone,
        }
        if (config.question_type === 'yes_no') {
          auditDetails.trigger_answer = config.trigger_answer
        } else {
          auditDetails.options_offered = config.options.map((o) => ({
            id: o.id,
            label: o.label,
            action_if_chosen: o.action_if_chosen,
          }))
          if (evalRes.outcome === 'triggered') {
            auditDetails.option_id_chosen = evalRes.option_id
            auditDetails.option_label_chosen = evalRes.option_label
          }
          if (evalRes.outcome === 'invalid_option') {
            auditDetails.option_id_reported = evalRes.option_id_reported
          }
        }
        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinicId,
          action: 'create_appointment_blocked_by_rule',
          actor_type: 'agent',
          target_type: 'consultation_type',
          target_id: consultationTypeId,
          details: auditDetails,
        })

        // 'ambiguous' y 'invalid_option' comparten el mismo mensaje al paciente:
        // safe default es derivar al humano sin alarmar.
        if (evalRes.outcome === 'ambiguous' || evalRes.outcome === 'invalid_option') {
          return {
            success: false,
            error: 'BLOCKED_BY_CONDITION_AMBIGUOUS',
            data: {
              rule_type: 'patient_condition',
              outcome: evalRes.outcome,
              question: config.question,
              must_escalate: true,
              message_for_patient:
                'Para asegurar que el servicio aplica en tu caso, prefiero que un asesor del consultorio lo confirme contigo. Ya les avisé y te contactan pronto.',
              escalate_reason: `Respuesta ambigua a pregunta obligatoria: "${config.question}". Requiere revisión del staff.`,
              escalate_urgency: 'medium',
            },
          }
        }

        // outcome === 'triggered' — aplicar action_on_trigger
        if (evalRes.action === 'derivar_humano') {
          return {
            success: false,
            error: 'BLOCKED_BY_CONDITION_DERIVAR',
            data: {
              rule_type: 'patient_condition',
              outcome: 'triggered',
              question: config.question,
              must_escalate: true,
              message_for_patient:
                'Para este servicio en tu caso necesito que un asesor del consultorio lo confirme contigo. Ya les avisé y te contactan pronto.',
              escalate_reason: `Paciente respondió "${literalAnswer}" (clasificada: ${classification}) a pregunta obligatoria "${config.question}" (dispara derivación según configuración de la clínica).`,
              escalate_urgency: 'medium',
            },
          }
        }

        // action === 'rechazar'
        return {
          success: false,
          error: 'BLOCKED_BY_CONDITION_RECHAZAR',
          data: {
            rule_type: 'patient_condition',
            outcome: 'triggered',
            question: config.question,
            must_escalate: false,
            message_for_patient:
              'Lo siento, por la respuesta que me diste no podemos agendarte este servicio en este momento. Te recomiendo contactar directamente al consultorio para que te orienten. ¿Te puedo ayudar con algo más?',
          },
        }
      }
      // Todas las respuestas son apt → continuar flujo normal.
    }
  }

  // Bloque 4 (requires_authorization) — CHECK DURO.
  //
  // Si el CT tiene regla auth_convenio activa Y el patient_eps declarado
  // matchea alguno de los convenios → BLOQUEAR create_appointment. La
  // cita la crea un humano desde el dashboard DESPUÉS de revisar la
  // autorización que el paciente envió por WhatsApp.
  //
  // La capa A (prompt) instruye al LLM a NO llamar create_appointment
  // en este caso. La capa B es defense in depth: si el LLM lo intenta
  // igual, lo bloqueamos y le decimos qué hacer.
  if (consultationTypeId && patientEps) {
    const { data: authRule } = await supabaseAdmin
      .from('consultation_type_rules')
      .select('id, condition_config')
      .eq('consultation_type_id', consultationTypeId)
      .eq('rule_type', 'requires_authorization')
      .eq('active', true)
      .maybeSingle()

    if (authRule) {
      const { AuthConvenioConfigSchema, convenioRequiresAuthorization, fillMessagePlaceholders } =
        await import('@/lib/rules/auth-convenio-config')
      const parsed = AuthConvenioConfigSchema.safeParse(authRule.condition_config)
      if (parsed.success) {
        const config = parsed.data
        const matches = convenioRequiresAuthorization(patientEps, config.convenios_que_requieren)
        if (matches) {
          // Obtener nombre del CT para el mensaje
          const { data: ctRow } = await supabaseAdmin
            .from('consultation_types')
            .select('name')
            .eq('id', consultationTypeId)
            .single()
          const servicioName = (ctRow as { name: string } | null)?.name ?? 'este servicio'

          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinicId,
            action: 'create_appointment_blocked_by_rule',
            actor_type: 'agent',
            target_type: 'consultation_type',
            target_id: consultationTypeId,
            details: {
              rule_type: 'requires_authorization',
              rule_id: authRule.id,
              patient_eps_declared: patientEps,
              convenios_configured: config.convenios_que_requieren,
              llm_attempted_anyway: true,
              patient_phone: patientPhone,
            },
          })

          const messageForPatient = fillMessagePlaceholders(
            config.message_pedir_archivo,
            { servicio: servicioName, convenio: patientEps },
          )

          return {
            success: false,
            error: 'BLOCKED_BY_AUTH_PENDING',
            data: {
              rule_type: 'requires_authorization',
              outcome: 'authorization_required',
              must_escalate: true,
              message_for_patient: messageForPatient,
              escalate_reason: `Servicio "${servicioName}" con convenio "${patientEps}" requiere autorización direccionada. El paciente debe enviarla por WhatsApp; un humano la revisa antes de agendar.`,
              escalate_urgency: 'medium',
              instruction_for_llm:
                'NO crees la cita. Pedile al paciente que envíe la autorización con el message_for_patient. Esperá el archivo (mensaje "📎 Autorización recibida"). Cuando llegue, escalá. La cita la crea un humano desde el dashboard.',
            },
          }
        }
      }
    }
  }

  // Calcular hora de fin: tipo de consulta > per-doctor config > default
  const waConfig = clinic.whatsapp_config as WhatsAppConfig | null
  const docConfig = waConfig?.doctors[doctorId]
  let duration = docConfig?.duration ?? waConfig?.appointment.default_duration ?? clinic.consultation_duration_minutes

  if (consultationTypeId) {
    const { data: ctData } = await supabaseAdmin
      .from('consultation_types')
      .select('id, duration_minutes, doctor_id')
      .eq('id', consultationTypeId)
      .eq('clinic_id', clinicId)
      .single()

    if (!ctData) {
      return { success: false, error: 'Tipo de consulta no encontrado. Verifica el ID y ofrece las opciones disponibles al paciente.' }
    }
    if (ctData.doctor_id && ctData.doctor_id !== doctorId) {
      // CAPA 2 — el servicio no existe bajo el médico que pidió la paciente.
      //
      // Éste es el momento exacto donde se rompió el 2026-08-17: la paciente
      // pidió "control o seguimiento" con Jorge Darío, ese tipo NO existe bajo
      // él (sí bajo Juan Diego y Angélica), y el modelo —en vez de decirlo— se
      // mudó de médico. Con pin puesto eso ya no es una opción: se le devuelve
      // el catálogo REAL del médico pedido y, si nada aplica, escala.
      if (pinMedico?.doctor_id) {
        const { data: suyos } = await supabaseAdmin
          .from('consultation_types')
          .select('id, name')
          .eq('clinic_id', clinicId)
          .eq('doctor_id', pinMedico.doctor_id)
          .eq('is_active', true)
          .eq('bookable_via_whatsapp', true)

        // Dedup por NOMBRE: el convenio es dimensión de fila, así que el mismo
        // servicio aparece N veces (una por eps_name). Sin esto la lista de una
        // médica con 27 filas y 9 servicios reales sería ilegible para el modelo.
        const vistos = new Set<string>()
        const lista = (suyos ?? [])
          .filter((c) => { const k = (c.name as string).toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true })
          .map((c) => `${c.name} (tipo_id: ${c.id})`)
        return {
          success: false,
          error: 'BLOCKED_BY_DOCTOR_PIN_SERVICE — El tipo de consulta pedido no existe bajo el médico que pidió la paciente.',
          data: {
            pinned_doctor_name: pinMedico.doctor_name,
            servicios_disponibles_con_ese_medico: lista,
            instruction_for_llm: lista.length > 0
              ? `Ese servicio NO lo presta ${pinMedico.doctor_name}. NO lo agendes con otro médico. ` +
                `Estos son los ÚNICOS servicios que él/ella sí atiende: ${lista.join(' · ')}. ` +
                `Si alguno es lo que la paciente necesita, confirmáselo y agendá ese. Si ninguno lo es, ` +
                `decíselo con honestidad ("ese servicio no lo atiende ${pinMedico.doctor_name}") y llamá ` +
                `escalate_to_human para que una persona del consultorio la oriente.`
              : `${pinMedico.doctor_name} no tiene servicios agendables por WhatsApp. Decíselo a la ` +
                `paciente y llamá escalate_to_human. NO la agendes con otro médico.`,
          },
        }
      }
      return { success: false, error: 'Ese tipo de consulta no corresponde al doctor seleccionado. Pregunta al paciente qué tipo de consulta necesita con este doctor.' }
    }
    duration = ctData.duration_minutes
  }

  const endsAt = calculateEndTime(startsAt, duration)

  // Doble-booking con la MISMA lógica de solapamiento que check_availability
  // (isSlotFree compartido) — no dos implementaciones distintas de "¿está libre?".
  const bookDateStr = format(toZonedTime(parseISO(startsAt), TIMEZONE), 'yyyy-MM-dd')
  const { data: dayAppts } = await supabaseAdmin
    .from('appointments')
    .select('starts_at, ends_at, status')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', [...BUSY_STATUSES])
    .gte('starts_at', `${bookDateStr}T00:00:00-05:00`)
    .lte('starts_at', `${bookDateStr}T23:59:59-05:00`)

  if (!isSlotFree(startsAt, endsAt, (dayAppts ?? []) as BusyAppointment[])) {
    return {
      success: false,
      error: 'SLOT_JUST_TAKEN — Ese horario se acaba de ocupar por otra persona mientras el paciente esperaba. DEBES: (1) disculparte: "Disculpa, ese horario se acaba de ocupar mientras hablábamos" (2) usar check_availability para buscar alternativas cercanas (3) ofrecer 2-3 opciones nuevas. NUNCA actúes como si nunca hubieras propuesto el horario original.',
    }
  }

  // Backstop de fecha/horario (SOLO camino agente): la cita debe ser FUTURA y
  // caber completa en una franja del médico. Defense in depth — el LLM no
  // debería llegar acá con una fecha mala, pero si lo hace, se bloquea y queda
  // auditado (llm_attempted_anyway).
  {
    const { data: schedDoctor } = await supabaseAdmin
      .from('doctors')
      .select('name, working_hours, agenda_closed')
      .eq('id', doctorId)
      .eq('clinic_id', clinicId)
      .single()
    const patientPhone = (input.patient_phone as string) ?? null

    // (1) Futuro
    if (!isFutureStart(startsAt, new Date())) {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'create_appointment_blocked_by_schedule',
        actor_type: 'agent',
        target_type: 'doctor',
        target_id: doctorId,
        details: { outcome: 'in_the_past', doctor_name: schedDoctor?.name ?? '', starts_at: startsAt, llm_attempted_anyway: true, patient_phone: patientPhone },
      })
      return {
        success: false,
        error: 'BLOCKED_BY_SCHEDULE',
        data: {
          outcome: 'in_the_past',
          message_for_patient: 'Esa fecha ya pasó. ¿Querés que busque un horario disponible próximamente?',
          instruction_for_llm: 'La fecha/hora pedida ya pasó. NO agendes. Ofrecé buscar disponibilidad futura con check_availability.',
        },
      }
    }

    const startZoned = toZonedTime(parseISO(startsAt), TIMEZONE)
    const endZoned = toZonedTime(parseISO(endsAt), TIMEZONE)
    const dayKey = dayKeyFromIndex(startZoned.getDay())
    const startHHMM = format(startZoned, 'HH:mm')
    const endHHMM = format(endZoned, 'HH:mm')
    const dateStr = format(startZoned, 'yyyy-MM-dd')

    // (2) Agenda cerrada del médico (mismo criterio que check_availability)
    if (schedDoctor?.agenda_closed) {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'create_appointment_blocked_by_schedule',
        actor_type: 'agent',
        target_type: 'doctor',
        target_id: doctorId,
        details: { outcome: 'agenda_closed', doctor_name: schedDoctor?.name ?? '', starts_at: startsAt, llm_attempted_anyway: true, patient_phone: patientPhone },
      })
      return {
        success: false,
        error: 'BLOCKED_BY_SCHEDULE',
        data: {
          outcome: 'agenda_closed',
          message_for_patient: 'La agenda de ese médico está cerrada en este momento. ¿Buscamos con otro médico?',
          instruction_for_llm: 'La agenda del médico está cerrada. NO agendes con él. Ofrecé otro médico de la misma especialidad o avisá que no hay agenda.',
        },
      }
    }

    // (3) Fecha bloqueada (doctor-específica o de toda la clínica)
    const { data: blockedRows } = await supabaseAdmin
      .from('blocked_dates')
      .select('id, doctor_id, reason')
      .eq('clinic_id', clinicId)
      .lte('start_date', dateStr)
      .gte('end_date', dateStr)
      .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
      .limit(1)
    if (blockedRows && blockedRows.length > 0) {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'create_appointment_blocked_by_schedule',
        actor_type: 'agent',
        target_type: 'doctor',
        target_id: doctorId,
        details: { outcome: 'blocked_date', doctor_name: schedDoctor?.name ?? '', starts_at: startsAt, date: dateStr, blocked_by: blockedRows[0].doctor_id ? 'doctor' : 'clinic', reason: blockedRows[0].reason ?? null, llm_attempted_anyway: true, patient_phone: patientPhone },
      })
      return {
        success: false,
        // Código PROPIO, distinto de BLOCKED_BY_SCHEDULE a propósito.
        //
        // Ese código lo comparten cuatro casos (fecha pasada, agenda cerrada,
        // fuera de franja y este), y los otros tres sí escalan: son señales de
        // que el modelo intentó algo que no debía. Este no. Que la clínica
        // bloquee un día es información de negocio corriente, y el agente puede
        // resolverla solo ofreciendo otra fecha.
        //
        // Antes caía en isHardBookingFailure y la paciente escuchaba "Uy, tuve
        // un inconveniente técnico" por un día que la clínica cerró a propósito
        // — y encima escalaba a una persona para algo que no la necesita. El
        // message_for_patient de acá abajo existía desde siempre y nunca se
        // usaba, porque el corte determinista lo descartaba antes.
        //
        // Se llama BLOCKED_BY_DATE por la familia a la que pertenece:
        // BLOCKED_BY_AGE, BLOCKED_BY_CONDITION, BLOCKED_BY_AUTH_PENDING — todas
        // reglas de negocio que el LLM narra en vez de escalar.
        error: 'BLOCKED_BY_DATE',
        data: {
          outcome: 'blocked_date',
          message_for_patient: 'Ese día no hay atención. ¿Buscamos otra fecha?',
          instruction_for_llm: 'Ese día está bloqueado (no hay atención). NO agendes ahí. Decile a la paciente que ese día no hay atención y usá check_availability para ofrecerle otra fecha. NO escales: esto lo resolvés vos.',
        },
      }
    }

    // (4) Cabe completa en la franja del médico
    const daySched = getDoctorDaySchedule(schedDoctor?.working_hours ?? null, dayKey)
    if (!isRangeWithinSchedule(startHHMM, endHHMM, daySched)) {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'create_appointment_blocked_by_schedule',
        actor_type: 'agent',
        target_type: 'doctor',
        target_id: doctorId,
        details: { outcome: 'out_of_schedule', doctor_name: schedDoctor?.name ?? '', starts_at: startsAt, ends_at: endsAt, day: dayKey, start_hhmm: startHHMM, end_hhmm: endHHMM, day_active: daySched.active, blocks: daySched.blocks, llm_attempted_anyway: true, patient_phone: patientPhone },
      })
      return {
        success: false,
        error: 'BLOCKED_BY_SCHEDULE',
        data: {
          outcome: 'out_of_schedule',
          message_for_patient: 'Ese horario no está dentro de la agenda del médico. ¿Buscamos otro?',
          instruction_for_llm: 'El horario cae fuera de la franja del médico o la cita no entra completa. NO agendes. Usá check_availability para ofrecer horarios válidos.',
        },
      }
    }
  }

  // Buscar o crear paciente
  let { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id, document_number, document_type, date_of_birth')
    .eq('clinic_id', clinicId)
    .eq('phone', patientPhone)
    .single()

  if (!patient) {
    const { data: newPatient, error: patientError } = await supabaseAdmin
      .from('patients')
      .insert({
        clinic_id: clinicId,
        name: patientName,
        phone: patientPhone,
        date_of_birth: dateOfBirth,
        document_type: documentType,
        document_number: documentNumber,
        ...(patientEmail && { email: patientEmail }),
        ...(patientEps && { eps: patientEps }),
        // Opt-in de canal WhatsApp: agendar por el agente ES la señal de opt-in
        // (Ley 1581, opt-in de canal ≠ data_consent_at). Sin esto una paciente
        // nueva que agenda no recibiría recordatorio (default false). Diseño del
        // equipo — antes estaba pendiente de construir.
        proactive_contact_opt_in: true,
      })
      .select('id, document_number, document_type, date_of_birth')
      .single()

    if (patientError) {
      console.error('[create_appointment] Error creando paciente:', patientError)
      return { success: false, error: 'Error registrando al paciente' }
    }
    patient = newPatient
  } else {
    // Paciente EXISTENTE: la identidad de la ficha MANDA. NUNCA se sobrescribe
    // cédula / tipo de documento / fecha de nacimiento con lo que mande el agente
    // — post-#2 el agente no tiene esos valores y los fabricaba para llenar el
    // required (observado: 1000000000 / 1996-01-01, corrompía la ficha). Solo se
    // RELLENA un campo de identidad si está vacío en el registro. name/email/eps
    // sí se actualizan (no son identidad dura).
    const p = patient as { id: string; document_number: string | null; document_type: string | null; date_of_birth: string | null }
    await supabaseAdmin
      .from('patients')
      .update({
        name: patientName,
        ...(!p.date_of_birth && dateOfBirth && { date_of_birth: dateOfBirth }),
        ...(!p.document_type && documentType && { document_type: documentType }),
        ...(!p.document_number && documentNumber && { document_number: documentNumber }),
        ...(patientEmail && { email: patientEmail }),
        ...(patientEps && { eps: patientEps }),
        // Agendar por el agente = opt-in de canal (ver insert). También para la
        // recurrente: confirma que el canal WhatsApp sigue activo.
        proactive_contact_opt_in: true,
      })
      .eq('id', patient.id)
  }

  if (!patient) return { success: false, error: 'Error registrando al paciente' }

  // Mapear procedure_entity a payment_type para la cita
  // EPS → EPS, Póliza → Póliza, ARL → ARL, SOAT → SOAT, cualquier otra → Particular
  const validPaymentTypes = ['EPS', 'Particular', 'Póliza', 'ARL', 'SOAT']
  const paymentType = procedureEntity && validPaymentTypes.includes(procedureEntity)
    ? procedureEntity
    : 'Particular'

  // Generar virtual_link si es cita virtual
  let virtualLink: string | null = null
  if (modality === 'virtual') {
    const virtualConfig = clinic.virtual_config as VirtualConsultationConfig | null
    if (virtualConfig?.enabled) {
      if (virtualConfig.platform === 'google_meet') {
        // Generar link único con formato meet.google.com/xxx-xxxx-xxx
        const chars = 'abcdefghijklmnopqrstuvwxyz'
        const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
        virtualLink = `https://meet.google.com/${seg(3)}-${seg(4)}-${seg(3)}`
      } else if (['zoom', 'teams', 'custom'].includes(virtualConfig.platform) && virtualConfig.base_url) {
        virtualLink = virtualConfig.base_url
      }
      // isalud: virtualLink stays null (manual)
    }
  }

  // Verificar si el tipo de consulta requiere documentos
  let documentsRequested = false
  let documentsDescription: string | null = null
  if (consultationTypeId) {
    const { data: ctInfo } = await supabaseAdmin
      .from('consultation_types')
      .select('requires_documents, required_documents_description')
      .eq('id', consultationTypeId)
      .eq('clinic_id', clinicId)
      .single()
    if (ctInfo?.requires_documents) {
      documentsRequested = true
      documentsDescription = ctInfo.required_documents_description ?? null
    }
  }

  // Crear la cita
  const { data: appointment, error: aptError } = await supabaseAdmin
    .from('appointments')
    .insert({
      clinic_id: clinicId,
      doctor_id: doctorId,
      patient_id: patient.id,
      starts_at: startsAt,
      ends_at: endsAt,
      reason,
      source: 'whatsapp_agent',
      payment_type: paymentType,
      consultation_type_id: consultationTypeId,
      modality,
      virtual_link: virtualLink,
      documents_requested: documentsRequested,
      free_text_reason: freeTextReason?.trim() || null,
    })
    .select('id, starts_at, ends_at')
    .single()

  if (aptError) {
    console.error('[create_appointment] Error creando cita:', aptError)
    return { success: false, error: 'Error creando la cita' }
  }

  // Incrementar contador de citas del paciente (no crítico si falla)
  try {
    await supabaseAdmin.rpc('increment_patient_appointments', { p_patient_id: patient.id })
  } catch { /* no crítico */ }

  // Registrar en auditoría (no crítico si falla)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'appointment_created',
        actor_type: 'agent',
        target_type: 'appointment',
        target_id: appointment.id,
        details: { patient_phone: patientPhone, starts_at: startsAt },
      })
  } catch { /* no crítico */ }

  // Sync Google Sheets (no crítico, fire-and-forget)
  try { syncClinicSheet(clinicId, ['appointments', 'patients']) } catch { /* no crítico */ }

  // Sync HIS externo (no crítico, fire-and-forget)
  const { data: docForHis } = await supabaseAdmin.from('doctors').select('name').eq('id', doctorId).single()
  const doctorNameForIcs = docForHis?.name ?? ''
  try {
    syncAppointmentToHis(clinicId, appointment.id, {
      patientName, patientPhone, patientDocumentNumber: documentNumber,
      doctorName: doctorNameForIcs, startsAt, endsAt, reason,
    })
  } catch { /* no crítico */ }

  // Lookup consultation type name for .ics
  let consultationTypeNameForIcs: string | null = null
  if (consultationTypeId) {
    const { data: ctForIcs } = await supabaseAdmin.from('consultation_types').select('name').eq('id', consultationTypeId).single()
    consultationTypeNameForIcs = ctForIcs?.name ?? null
  }

  // Notificar al staff por WhatsApp (mitiga gap transición Algia ↔ iSalud — fire-and-forget)
  notifyStaffAppointmentCreated({
    clinicId,
    patientName,
    patientPhone,
    doctorName: doctorNameForIcs,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    consultationTypeName: consultationTypeNameForIcs,
    reason,
    modality,
  }).catch(() => { /* never throw — el helper ya hace su propio try/catch */ })

  // Construir mensaje de éxito
  let successMessage = 'Cita creada exitosamente'
  if (modality === 'virtual') {
    successMessage = 'Cita virtual creada exitosamente. Informar al paciente que recibirá el link de videollamada 30 minutos antes.'
  }
  if (documentsRequested) {
    successMessage += ` IMPORTANTE: Esta cita requiere documentos previos${documentsDescription ? ` (${documentsDescription})` : ''}. Recuérdale al paciente que debe enviar los documentos por este chat antes de la cita.`
  }

  // Extract date part from starts_at for day-of-week (use Bogota noon to avoid timezone edge)
  const aptDateStr = format(toZonedTime(parseISO(appointment.starts_at), TIMEZONE), 'yyyy-MM-dd')

  return {
    success: true,
    data: {
      appointment_id: appointment.id,
      starts_at: appointment.starts_at,
      ends_at: appointment.ends_at,
      formatted_date: formatForPatient(appointment.starts_at),
      day_of_week_spanish: spanishDayOfWeek(aptDateStr),
      confirmed_date_iso: aptDateStr,
      modality,
      virtual_link: virtualLink,
      documents_requested: documentsRequested,
      documents_description: documentsDescription,
      message: successMessage,
      appointmentData: {
        id: appointment.id,
        starts_at: appointment.starts_at,
        ends_at: appointment.ends_at,
        doctor_name: doctorNameForIcs,
        consultation_type: consultationTypeNameForIcs,
        sequence: 0,
      },
    },
  }
}

// ============================================================
// GET PATIENT APPOINTMENTS — Citas futuras del paciente
// ============================================================
async function getPatientAppointments(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const phone = normalizePhone(input.patient_phone as string)

  // Buscar paciente
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('phone', phone)
    .single()

  if (!patient) {
    return {
      success: true,
      data: { appointments: [], message: 'No se encontró el paciente. Puede que sea nuevo.' },
    }
  }

  // Buscar citas futuras confirmadas
  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, ends_at, status, reason, doctor_id, modality')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patient.id)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[get_patient_appointments] Error:', error)
    return { success: false, error: 'Error consultando citas' }
  }

  // Formatear para que Claude las muestre bonito
  const formatted = (appointments ?? []).map((apt) => ({
    appointment_id: apt.id,
    date: formatForPatient(apt.starts_at),
    time: formatTimeForPatient(apt.starts_at),
    status: apt.status,
    reason: apt.reason,
    modality: apt.modality ?? 'presencial',
  }))

  return {
    success: true,
    data: {
      appointments: formatted,
      total: formatted.length,
    },
  }
}

// ============================================================
// CANCEL APPOINTMENT — Cancelar cita
// ============================================================
async function cancelAppointment(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const appointmentId = input.appointment_id as string
  const reason = input.reason as string

  // Verificar que la cita existe y pertenece a esta clínica
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id, status, patient_id, doctor_id, starts_at, ends_at, calendar_sequence')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()

  if (!appointment) {
    return { success: false, error: 'Cita no encontrada' }
  }

  if (appointment.status === 'cancelled') {
    return { success: false, error: 'Esta cita ya está cancelada' }
  }

  // Backstop de fecha: no se cancela una cita ya pasada. Cancelar dispara
  // notifyWaitlist + syncCancelToHis + sync de Sheets (efectos hacia afuera);
  // sobre un cupo que ya ocurrió no tienen sentido.
  if (!isFutureStart(appointment.starts_at, new Date())) {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'cancel_appointment_blocked_past',
      actor_type: 'agent',
      target_type: 'appointment',
      target_id: appointmentId,
      details: { starts_at: appointment.starts_at, llm_attempted_anyway: true },
    })
    return {
      success: false,
      error: 'BLOCKED_PAST_APPOINTMENT',
      data: {
        outcome: 'in_the_past',
        message_for_patient: 'Esa cita ya pasó, no hay nada que cancelar. ¿Querés agendar una nueva?',
        instruction_for_llm: 'La cita ya ocurrió (fecha pasada). NO la canceles. Si el paciente quiere, ofrecé agendar una nueva con check_availability.',
      },
    }
  }

  // Increment calendar_sequence for .ics cancel
  const cancelSeq = ((appointment.calendar_sequence as number) ?? 0) + 1

  // Cancelar la cita
  const { error } = await supabaseAdmin
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
      calendar_sequence: cancelSeq,
    })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  if (error) {
    console.error('[cancel_appointment] Error:', error)
    return { success: false, error: 'Error cancelando la cita' }
  }

  // Registrar en auditoría (no crítico si falla)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'appointment_cancelled',
        actor_type: 'agent',
        target_type: 'appointment',
        target_id: appointmentId,
        details: { reason },
      })
  } catch { /* no crítico */ }

  // Sync Google Sheets (no crítico, fire-and-forget)
  try { syncClinicSheet(clinicId, ['appointments', 'finances', 'noshow_stats']) } catch { /* no crítico */ }

  // Sync cancelación al HIS externo (no crítico, fire-and-forget)
  try { syncCancelToHis(clinicId, appointmentId) } catch { /* no crítico */ }

  // Revisar si hay alguien en lista de espera para ese doctor
  await notifyWaitlist(clinicId, appointment.doctor_id, appointment.starts_at)

  // Lookup doctor name for .ics cancel
  const { data: cancelDoc } = await supabaseAdmin.from('doctors').select('name').eq('id', appointment.doctor_id).single()

  return {
    success: true,
    data: {
      cancelled_appointment_id: appointmentId,
      message: 'Cita cancelada exitosamente. Ofrece reagendar al paciente.',
      appointmentData: {
        id: appointmentId,
        starts_at: appointment.starts_at,
        ends_at: appointment.ends_at,
        doctor_name: cancelDoc?.name ?? '',
        consultation_type: null,
        sequence: cancelSeq,
      },
    },
  }
}

// ============================================================
// RESCHEDULE APPOINTMENT — Reagendar cita
// ============================================================
async function rescheduleAppointment(
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic,
  pinMedico?: DoctorPin | null
): Promise<ToolResult> {
  const appointmentId = input.appointment_id as string
  const newStartsAt = input.new_starts_at as string

  // Verificar que la cita existe
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id, doctor_id, patient_id, starts_at, payment_type, reason, consultation_type_id, modality, virtual_link, calendar_sequence')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()

  if (!appointment) {
    return { success: false, error: 'Cita no encontrada' }
  }

  // ¿Es la cita del médico que pidió la paciente?
  //
  // Acá el pin se chequea distinto que en las otras tools: reschedule no recibe
  // `doctor_id`, hereda el de la cita. El riesgo no es que el modelo apunte a
  // otro médico, sino que MUEVA la cita equivocada — una paciente con citas con
  // dos médicos nombra a uno y el modelo reagenda la del otro.
  //
  // Por eso NO es un bloqueo terminal: es probable que quiera mover esa otra
  // cita a propósito. Se le devuelve al modelo para que lo confirme con ella en
  // palabras, en vez de decidirlo por su cuenta.
  if (pinMedico?.doctor_id && appointment.doctor_id && appointment.doctor_id !== pinMedico.doctor_id) {
    const { data: docCita } = await supabaseAdmin
      .from('doctors').select('name').eq('id', appointment.doctor_id).maybeSingle()
    return {
      success: false,
      error: 'BLOCKED_BY_DOCTOR_PIN_RESCHEDULE — La cita que se intenta mover es de otro médico.',
      data: {
        pinned_doctor_name: pinMedico.doctor_name,
        appointment_doctor_name: docCita?.name ?? 'otro médico',
        instruction_for_llm:
          `En esta conversación la paciente nombró a ${pinMedico.doctor_name}, pero la cita que ibas a ` +
          `reagendar es con ${docCita?.name ?? 'otro médico'}. NO la muevas todavía. Preguntale a ella, ` +
          `con los dos nombres explícitos, cuál de las dos citas quiere cambiar. Recién con su respuesta ` +
          `volvé a llamar reschedule_appointment con el appointment_id correcto.`,
      },
    }
  }

  // Backstop de fecha: ni la cita original ni la nueva pueden estar en el pasado.
  {
    const nowR = new Date()
    if (!isFutureStart(appointment.starts_at, nowR)) {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'reschedule_appointment_blocked_past',
        actor_type: 'agent',
        target_type: 'appointment',
        target_id: appointmentId,
        details: { which: 'original', original_starts_at: appointment.starts_at, llm_attempted_anyway: true },
      })
      return {
        success: false,
        error: 'BLOCKED_PAST_APPOINTMENT',
        data: {
          outcome: 'original_in_the_past',
          message_for_patient: 'Esa cita ya pasó, así que no se puede reagendar. ¿Querés que agende una nueva?',
          instruction_for_llm: 'La cita original ya ocurrió (fecha pasada). NO la reagendes. Ofrecé agendar una nueva con check_availability + create_appointment.',
        },
      }
    }
    if (!isFutureStart(newStartsAt, nowR)) {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'reschedule_appointment_blocked_past',
        actor_type: 'agent',
        target_type: 'appointment',
        target_id: appointmentId,
        details: { which: 'new', new_starts_at: newStartsAt, llm_attempted_anyway: true },
      })
      return {
        success: false,
        error: 'BLOCKED_PAST_APPOINTMENT',
        data: {
          outcome: 'new_in_the_past',
          message_for_patient: 'Esa fecha ya pasó. ¿Buscamos un horario disponible próximamente?',
          instruction_for_llm: 'El nuevo horario pedido ya pasó. NO reagendes ahí. Usá check_availability para ofrecer horarios futuros.',
        },
      }
    }
  }

  // Calcular duración: tipo de consulta > config doctor > default clínica
  let rescheduleDuration = clinic.consultation_duration_minutes
  if (appointment.consultation_type_id) {
    const { data: ctData } = await supabaseAdmin
      .from('consultation_types')
      .select('duration_minutes')
      .eq('id', appointment.consultation_type_id)
      .eq('clinic_id', clinicId)
      .single()
    if (ctData) rescheduleDuration = ctData.duration_minutes
  }
  const newEndsAt = calculateEndTime(newStartsAt, rescheduleDuration)

  // Verificar que el nuevo horario no tenga conflicto
  const { data: conflict } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', appointment.doctor_id)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .neq('id', appointmentId)
    .lt('starts_at', newEndsAt)
    .gt('ends_at', newStartsAt)
    .limit(1)

  if (conflict && conflict.length > 0) {
    return {
      success: false,
      error: 'El nuevo horario ya está ocupado. Ofrece otro horario.',
    }
  }

  // Marcar la cita actual como reagendada
  await supabaseAdmin
    .from('appointments')
    .update({ status: 'rescheduled' })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  // Crear la nueva cita (copiar payment_type y reason de la original)
  const { data: newAppointment, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      clinic_id: clinicId,
      doctor_id: appointment.doctor_id,
      patient_id: appointment.patient_id,
      starts_at: newStartsAt,
      ends_at: newEndsAt,
      source: 'whatsapp_agent',
      payment_type: appointment.payment_type,
      reason: appointment.reason,
      consultation_type_id: appointment.consultation_type_id,
      modality: appointment.modality ?? 'presencial',
      virtual_link: appointment.virtual_link ?? null,
    })
    .select('id, starts_at, ends_at')
    .single()

  if (error) {
    console.error('[reschedule_appointment] Error:', error)
    return { success: false, error: 'Error reagendando la cita' }
  }

  // Auditoría (no crítico si falla)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'appointment_rescheduled',
        actor_type: 'agent',
        target_type: 'appointment',
        target_id: newAppointment.id,
        details: {
          old_appointment_id: appointmentId,
          old_starts_at: appointment.starts_at,
          new_starts_at: newStartsAt,
        },
      })
  } catch { /* no crítico */ }

  // Sync Google Sheets (no crítico, fire-and-forget)
  try { syncClinicSheet(clinicId, ['appointments']) } catch { /* no crítico */ }

  // Lookup doctor name (needed for HIS sync + .ics)
  const { data: docForHis } = await supabaseAdmin.from('doctors').select('name').eq('id', appointment.doctor_id).single()

  // Sync reagendamiento al HIS externo (cancelar vieja + crear nueva)
  try {
    syncCancelToHis(clinicId, appointmentId)
    const { data: patForHis } = await supabaseAdmin.from('patients').select('name, phone, document_number').eq('id', appointment.patient_id).single()
    if (patForHis) {
      syncAppointmentToHis(clinicId, newAppointment.id, {
        patientName: patForHis.name, patientPhone: patForHis.phone,
        patientDocumentNumber: patForHis.document_number,
        doctorName: docForHis?.name ?? '', startsAt: newStartsAt, endsAt: newEndsAt,
        reason: appointment.reason,
      })
    }
  } catch { /* no crítico */ }

  // Revisar waitlist para el horario liberado
  await notifyWaitlist(clinicId, appointment.doctor_id, appointment.starts_at)

  // Increment calendar_sequence for .ics update
  const oldSeq = (appointment.calendar_sequence as number) ?? 0
  const newSeq = oldSeq + 1
  await supabaseAdmin.from('appointments').update({ calendar_sequence: newSeq }).eq('id', newAppointment.id)

  // Get doctor name for .ics (already queried for HIS sync)
  const reschDocName = docForHis?.name ?? ''

  return {
    success: true,
    data: {
      new_appointment_id: newAppointment.id,
      new_date: formatForPatient(newAppointment.starts_at),
      message: 'Cita reagendada exitosamente',
      appointmentData: {
        id: newAppointment.id,
        starts_at: newAppointment.starts_at,
        ends_at: newAppointment.ends_at,
        doctor_name: reschDocName,
        consultation_type: null,
        sequence: newSeq,
      },
    },
  }
}

// ============================================================
// ESCALATE TO HUMAN — Escalar a humano
// ============================================================
async function escalateToHuman(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const reason = input.reason as string
  const urgency = input.urgency as string

  // Auditoría (no crítico si falla)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        clinic_id: clinicId,
        action: 'conversation_escalated',
        actor_type: 'agent',
        details: { reason, urgency },
      })
  } catch { /* no crítico */ }

  return {
    success: true,
    data: {
      escalated: true,
      urgency,
      message:
        urgency === 'emergency'
          ? 'Escalado como EMERGENCIA. Informar al paciente que alguien lo contactará pronto.'
          : 'Escalado al equipo. Informar al paciente que alguien del consultorio lo contactará pronto.',
    },
  }
}

// ============================================================
// ADD TO WAITLIST — Agregar a lista de espera
// ============================================================
async function addToWaitlist(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const doctorId = input.doctor_id as string
  const phone = normalizePhone(input.patient_phone as string)
  const preferredDates = (input.preferred_dates as string[]) ?? []
  const preferredTime = (input.preferred_time as string) ?? 'any'
  const reason = (input.reason as string) ?? null
  const preferredScheduleNotes = (input.preferred_schedule_notes as string) ?? null
  const consultationTypeName = (input.consultation_type_name as string) ?? null

  // Buscar paciente
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('phone', phone)
    .single()

  if (!patient) {
    return { success: false, error: 'Paciente no encontrado' }
  }

  // Verificar que no esté ya en lista de espera activa
  const { data: existing } = await supabaseAdmin
    .from('waitlist')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patient.id)
    .eq('status', 'waiting')
    .limit(1)

  if (existing && existing.length > 0) {
    return {
      success: true,
      data: { already_waiting: true, message: 'El paciente ya está en la lista de espera' },
    }
  }

  // Agregar a la lista
  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({
      clinic_id: clinicId,
      patient_id: patient.id,
      doctor_id: doctorId,
      preferred_dates: preferredDates,
      preferred_time: preferredTime,
      reason,
      preferred_schedule_notes: preferredScheduleNotes,
      consultation_type_name: consultationTypeName,
      source: 'whatsapp',
    })

  if (error) {
    console.error('[add_to_waitlist] Error:', error)
    return { success: false, error: 'Error agregando a la lista de espera' }
  }

  // Audit log
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: preferredScheduleNotes ? 'manual_booking_requested' : 'waitlist_entry_created',
      actor_type: 'agent',
      target_type: 'waitlist',
      details: { doctor_id: doctorId, consultation_type_name: consultationTypeName, source: 'whatsapp' },
    })
  } catch { /* no crítico */ }

  return {
    success: true,
    data: {
      added: true,
      message: preferredScheduleNotes
        ? 'Solicitud de cita manual registrada. El consultorio contactará al paciente para confirmar.'
        : 'Paciente agregado a la lista de espera. Se le notificará si se abre un espacio.',
    },
  }
}

// ============================================================
// NOTIFY WAITLIST — Notificar al siguiente en lista de espera
// Se llama automáticamente al cancelar o reagendar una cita
// ============================================================
async function notifyWaitlist(
  clinicId: string,
  doctorId: string,
  freedSlotStartsAt: string
): Promise<void> {
  try {
    // Buscar el primero en la lista de espera para ese doctor
    const { data: waitlistEntry } = await supabaseAdmin
      .from('waitlist')
      .select('id, patient_id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorId)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (!waitlistEntry) return // No hay nadie esperando

    // Obtener teléfono del paciente
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('phone, name')
      .eq('id', waitlistEntry.patient_id)
      .single()

    if (!patient) return

    // Marcar como notificado
    await supabaseAdmin
      .from('waitlist')
      .update({ status: 'notified', notified_at: new Date().toISOString() })
      .eq('id', waitlistEntry.id)

    // Enviar mensaje por WhatsApp
    const formattedDate = formatForPatient(freedSlotStartsAt)
    const message =
      `¡Hola ${patient.name}! 🎉 Se liberó un espacio: ${formattedDate}. ` +
      `¿Te gustaría agendarte? Responde "sí" para confirmar.`

    // Quitar el "+" del teléfono para WhatsApp API
    const whatsappNumber = patient.phone.replace('+', '')
    const creds = await getClinicCreds(clinicId)
    if (!creds) { console.warn(`[notifyWaitlist] Sin WhatsApp: ${clinicId}`); return }
    await sendWhatsAppMessage(whatsappNumber, message, creds)
  } catch (error) {
    // No es crítico — la cita ya se canceló, el paciente simplemente no se entera
    console.error('[notifyWaitlist] Error:', error)
  }
}

// ============================================================
// CHECK EPS CONVENIO — Verificar si la clínica tiene convenio con una EPS
// ============================================================
async function checkEpsConvenio(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const epsName = (input.eps_name as string ?? '').trim()
  if (!epsName) return { success: false, error: 'Nombre de EPS vacío' }

  // 🛑 PARTICULAR SE CORTA ANTES DE BUSCAR.
  // No es un convenio que falte: es la categoría más grande de la clínica
  // (12.795 citas, más que cualquier aseguradora) y una respuesta esperable,
  // porque el agente ofrece "¿EPS, prepagada o particular?" en el mismo mensaje.
  // Sin este corte cae en CONVENIO_NO_RECONOCIDO y escala — el caso más común
  // convertido en cola para el staff, todos los días.
  if (dijoParticular(epsName)) {
    return {
      success: true,
      data: {
        esParticular: true,
        hasConvenio: false,
        message: 'La paciente paga como particular: NO hace falta convenio. Seguí el flujo normal de agendamiento; si pregunta el valor, usá get_consultation_price con modo particular.',
      },
    }
  }

  const insurerTypeFilter = input.insurer_type === 'EPS' || input.insurer_type === 'Prepagada'
    ? input.insurer_type as 'EPS' | 'Prepagada'
    : null

  // Normalizar para búsqueda flexible
  const searchTerm = epsName.toLowerCase()

  // ⚠️ EL TIPO NO FILTRA. DESEMPATA.
  //
  // Antes esta query hacía `.eq('insurer_type', insurerTypeFilter)`, y como el
  // 64% de los convenios de una clínica real tiene `insurer_type` NULL (nadie
  // los clasificó nunca), el filtro los borraba del resultado ANTES de comparar
  // el nombre. Una paciente de 8 años y 13 citas dijo "Medplus", el modelo lo
  // clasificó como Prepagada, MEDPLUS estaba cargado con tipo NULL, y la tool
  // contestó "no tenemos convenio". El nombre matcheaba perfecto; nunca llegó a
  // compararse.
  //
  // El criterio es ASIMÉTRICO a propósito: decirle "no tenemos convenio" a
  // alguien que sí lo tiene la manda a colgar —y no deja rastro, porque no es
  // un error, es una respuesta—. Ofrecer un convenio que después la secretaria
  // corrige cuesta una llamada. Ante la duda, se devuelve el convenio.
  const { data: matches } = await supabaseAdmin
    .from('consultation_types')
    .select('eps_name, insurer_type')
    .eq('clinic_id', clinicId)
    .not('eps_name', 'is', null)

  // Match flexible: partial match case-insensitive
  type Row = { eps_name: string; insurer_type: 'EPS' | 'Prepagada' | null }
  const rows = (matches ?? []) as Row[]
  const porNombre = rows.filter((r) => {
    const lower = r.eps_name.toLowerCase()
    if (lower.includes(searchTerm) || searchTerm.includes(lower.replace(/[.\s]+/g, ''))) return true
    // Alias: la paciente dice "SOS" y está cargado como la razón social completa,
    // sin una letra en común. Sin esto el convenio existe y es inalcanzable.
    return mismoConvenioPorAlias(epsName, r.eps_name)
  })

  // Con varios homónimos (una aseguradora que opera EPS y prepagada a la vez,
  // como SURA), el tipo elige cuál. Si ninguno coincide, gana el primero igual:
  // el convenio existe, y el tipo lo corrige una persona.
  const found =
    (insurerTypeFilter ? porNombre.find((r) => r.insurer_type === insurerTypeFilter) : undefined)
    ?? porNombre[0]

  // Cuando el tipo pedido no coincide con el que está cargado, el modelo tiene
  // que saberlo para no afirmar de más.
  const tipoNoCoincide =
    !!found && !!insurerTypeFilter && found.insurer_type !== null && found.insurer_type !== insurerTypeFilter

  // También buscar en isalud_import_staging (puede haber convenios no importados aún).
  // El guard `!insurerTypeFilter` se sacó por lo mismo: era la segunda red que
  // el filtro de tipo desactivaba justo cuando más falta hacía.
  if (!found) {
    const { data: staging } = await supabaseAdmin
      .from('isalud_import_staging')
      .select('convenio_nombre_abreviado')
      .eq('clinic_id', clinicId)
      .limit(1)
      .ilike('convenio_nombre_abreviado', `%${searchTerm}%`)

    if (staging && staging.length > 0) {
      return {
        success: true,
        data: {
          hasConvenio: true,
          convenioExacto: staging[0].convenio_nombre_abreviado,
          insurerType: null,
          needsClassification: true,
          source: 'staging',
        },
      }
    }
  }

  if (found) {
    return {
      success: true,
      data: {
        hasConvenio: true,
        convenioExacto: found.eps_name,
        insurerType: found.insurer_type,
        needsClassification: found.insurer_type === null,
        source: 'consultation_types',
        // El convenio existe, pero está cargado como otro tipo. No es motivo
        // para negarlo: es motivo para no afirmar la modalidad.
        ...(tipoNoCoincide
          ? {
              tipoDistintoAlPreguntado: true,
              message: `Sí hay convenio con "${found.eps_name}", pero está cargado como ${found.insurer_type}, no como ${insurerTypeFilter}. Confirma el convenio SIN afirmar la modalidad; el consultorio valida el plan.`,
            }
          : {}),
      },
    }
  }

  // ⚠️ NO ENCONTRADO ≠ NO EXISTE.
  //
  // Antes esto devolvía "no hay convenio, ofrece particular" y el modelo
  // obedecía. Pero el catálogo cubre 4.008 de las 10.734 pacientes con entidad
  // registrada: para las otras 6.525, "no lo encuentro" y "no lo hay" son cosas
  // distintas, y afirmar la segunda las empuja a pagar particular teniendo
  // cobertura. Es lo que le pasó a una paciente de 8 años con 13 citas.
  //
  // Se corta determinista y se escala. NO se le pasa al LLM para que lo narre:
  // el turno anterior demostró que narra con fidelidad lo que le dicta la tool,
  // así que una instrucción de prompt acá sería capa A para algo que tiene que
  // ser garantía.
  //
  // El log deja la entidad TAL COMO LA ESCRIBIÓ. En una semana esa consulta es
  // la lista real de convenios faltantes ordenada por frecuencia — mejor que
  // deducirla del histórico, porque son las que la gente efectivamente pide.
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'convenio_no_reconocido',
      actor_type: 'agent',
      details: {
        entidad_dicha: epsName,
        insurer_type_preguntado: insurerTypeFilter,
        convenios_cargados: rows.length,
      },
    })
  } catch { /* no crítico: nunca romper la conversación por el log */ }

  return {
    success: false,
    error: `CONVENIO_NO_RECONOCIDO ${epsName}`,
  }
}

// ============================================================
// GET CONSULTATION PRICE — La regla de precio vive en price-tool-logic,
// este tool solo lee el consultation_type y delega la decisión (B1).
// NUNCA calcula ni expone un precio por su cuenta.
// ============================================================
async function getConsultationPrice(
  input: Record<string, unknown>,
  clinicId: string
): Promise<ToolResult> {
  const ctId = (input.consultation_type_id as string | undefined)?.trim()
  if (!ctId) {
    return {
      success: true,
      data: {
        action: 'ask_mode',
        message: 'Para decirte el valor necesito saber cómo vas a pagar: ¿particular, EPS o medicina prepagada?',
      },
    }
  }

  const { data: ct } = await supabaseAdmin
    .from('consultation_types')
    .select('name, price, eps_name')
    .eq('id', ctId)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  if (!ct) {
    return {
      success: true,
      data: {
        action: 'no_particular_price',
        message: 'Ese valor lo confirma el equipo del consultorio; ¿quieres que te agende?',
      },
    }
  }

  const mode = normalizePaymentMode(input.modo_pago as string | undefined)
  const decision = decidePriceResponse(ct as PriceCtInput, mode)
  return { success: true, data: { action: decision.action, message: decision.message } }
}

// ============================================================
// CALCULATE DATE — Resolver día de la semana a fecha exacta
// Evita que Claude haga aritmética de calendario (alucinación)
// ============================================================

const DAY_MAP: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, 'miercoles': 3,
  jueves: 4, viernes: 5, sábado: 6, 'sabado': 6,
}

function calculateDate(input: Record<string, unknown>): ToolResult {
  const dayName = (input.day_of_week as string)?.toLowerCase().trim()
  const reference = (input.reference as string) ?? 'this'

  const targetDay = DAY_MAP[dayName]
  if (targetDay === undefined) {
    return { success: false, error: `Día "${dayName}" no reconocido. Usa: lunes, martes, miércoles, jueves, viernes, sábado, domingo.` }
  }

  const now = toZonedTime(new Date(), TIMEZONE)
  const currentDay = now.getDay() // 0=domingo, 1=lunes, ...

  let daysToAdd: number
  if (reference === 'this') {
    // "Este lunes" = el más próximo, puede ser hoy
    daysToAdd = (targetDay - currentDay + 7) % 7
    if (daysToAdd === 0) daysToAdd = 0 // today is that day
  } else if (reference === 'next') {
    // "Próximo lunes" = el de la siguiente semana (siempre > 0)
    daysToAdd = (targetDay - currentDay + 7) % 7
    if (daysToAdd === 0) daysToAdd = 7 // if today is that day, go to next week
    else daysToAdd += 7 // always next week
  } else {
    // in_two_weeks
    daysToAdd = (targetDay - currentDay + 7) % 7
    if (daysToAdd === 0) daysToAdd = 14
    else daysToAdd += 14
  }

  const targetDate = new Date(now)
  targetDate.setDate(targetDate.getDate() + daysToAdd)

  const dateStr = format(targetDate, 'yyyy-MM-dd')
  const dayOfWeekSpanish = SPANISH_DAY_NAMES[targetDate.getDay()]
  const formattedDate = format(targetDate, "EEEE d 'de' MMMM", { locale: es })

  return {
    success: true,
    data: {
      date: dateStr,
      day_of_week_spanish: dayOfWeekSpanish,
      formatted_date: formattedDate,
      is_today: daysToAdd === 0,
      days_from_today: daysToAdd,
    },
  }
}
