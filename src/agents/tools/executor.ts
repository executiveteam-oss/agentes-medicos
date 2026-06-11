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
import type { Clinic, Doctor, WhatsAppConfig, VirtualConsultationConfig, WorkingBlock } from '@/types/database'
import { parseISO, addMinutes, format, isValid } from 'date-fns'
import { es } from 'date-fns/locale'
import { toZonedTime } from 'date-fns-tz'

const TIMEZONE = 'America/Bogota'
const SPANISH_DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Día de la semana en español para una fecha YYYY-MM-DD */
function spanishDayOfWeek(dateStr: string): string {
  return SPANISH_DAY_NAMES[toZonedTime(parseISO(`${dateStr}T12:00:00-05:00`), TIMEZONE).getDay()]
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
  doctor: Doctor
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'check_availability':
        return await checkAvailability(input, clinicId, clinic, doctor)

      case 'create_appointment':
        return await createAppointment(input, clinicId, clinic)

      case 'get_patient_appointments':
        return await getPatientAppointments(input, clinicId)

      case 'cancel_appointment':
        return await cancelAppointment(input, clinicId)

      case 'reschedule_appointment':
        return await rescheduleAppointment(input, clinicId, clinic)

      case 'escalate_to_human':
        return await escalateToHuman(input, clinicId)

      case 'add_to_waitlist':
        return await addToWaitlist(input, clinicId)

      case 'calculate_date':
        return calculateDate(input)

      case 'check_eps_convenio':
        return await checkEpsConvenio(input, clinicId)

      default:
        return { success: false, error: `Tool "${toolName}" no reconocida` }
    }
  } catch (error) {
    console.error(`[Tool:${toolName}] Error:`, error)
    return {
      success: false,
      error: 'Ocurrió un error interno. Informa al paciente que hubo un problema y puede escribir "hablar con humano".',
    }
  }
}

// ============================================================
// CHECK AVAILABILITY — Buscar horarios disponibles
// ============================================================
async function checkAvailability(
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic,
  doctor: Doctor
): Promise<ToolResult> {
  const preferredDate = input.preferred_date as string | undefined
  const doctorId = (input.doctor_id as string) || doctor.id

  // Verificar si el doctor tiene agenda cerrada o disponibilidad manual
  const { data: targetDoctor } = await supabaseAdmin
    .from('doctors')
    .select('agenda_closed, agenda_closed_reason, agenda_closed_until, name, schedule_type, manual_availability_message')
    .eq('id', doctorId)
    .eq('clinic_id', clinicId)
    .single()

  // Doctor con disponibilidad manual — no mostrar slots
  if (targetDoctor?.schedule_type === 'manual') {
    const manualMsg = targetDoctor.manual_availability_message
      ?? 'Este médico no tiene horario fijo. Recoge los datos del paciente y usa add_to_waitlist.'
    return {
      success: true,
      data: {
        available: false,
        schedule_type: 'manual',
        reason: manualMsg,
        doctor_name: targetDoctor.name,
        message: 'Este doctor tiene disponibilidad manual. NO muestres horarios. Muestra el mensaje del doctor al paciente, recoge nombre, tipo de consulta y preferencia de horario, y usa add_to_waitlist con preferred_schedule_notes.',
      },
    }
  }

  if (targetDoctor?.agenda_closed) {
    const untilText = targetDoctor.agenda_closed_until
      ? ` hasta el ${format(parseISO(targetDoctor.agenda_closed_until), "d 'de' MMMM", { locale: es })}`
      : ''

    // Si es vacaciones, usar mensaje personalizado si existe
    let closedMessage = `La agenda de ${targetDoctor.name} está cerrada${untilText}. ${targetDoctor.agenda_closed_reason ? `Motivo: ${targetDoctor.agenda_closed_reason}. ` : ''}No se pueden agendar citas con este doctor en este momento.`

    if (targetDoctor.agenda_closed_reason === 'Vacaciones') {
      const config = clinic.whatsapp_config as Record<string, unknown> | null
      const vacationMsg = config?.vacation_message as string | undefined
      if (vacationMsg) {
        closedMessage = vacationMsg
          .replace(/\[fecha\]/gi, targetDoctor.agenda_closed_until
            ? format(parseISO(targetDoctor.agenda_closed_until), "d 'de' MMMM", { locale: es })
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
        reason: blocked.reason
          ? (blockedBy === 'doctor'
              ? `${doctor.name} no atiende ese día (${dow}) por: ${blocked.reason}. Ofrece otro día con este doctor o propón otro doctor de la misma especialidad.`
              : `El consultorio no atiende ese día (${dow}) por: ${blocked.reason}. Ofrece otro día.`)
          : (blockedBy === 'doctor'
              ? `${doctor.name} no atiende ese día (${dow}). Ofrece otro día con este doctor o propón otro doctor.`
              : `El consultorio no atiende ese día (${dow}). Ofrece otro día.`),
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

  // Determinar bloques horarios del día.
  // Precedencia: doctor.working_hours (per-day blocks) > whatsapp_config.doctors[id] > clinic.working_hours
  const dayOfWeek = getDayOfWeek(date)
  const dayKey = dayOfWeek as keyof typeof clinic.working_hours
  let isDayActive = false
  let dayBlocks: WorkingBlock[] = []

  // 1) doctor.working_hours per-day (formato nuevo o viejo, ambos normalizados)
  if (doctor.working_hours) {
    const docHours = normalizeWorkingHours(doctor.working_hours)
    const dayCfg = docHours[dayKey]
    if (dayCfg.active && dayCfg.blocks.length > 0) {
      isDayActive = true
      dayBlocks = dayCfg.blocks
    } else if (!dayCfg.active) {
      // El doctor explícitamente marcó este día como inactivo
      isDayActive = false
      dayBlocks = []
    }
  }

  // 2) Fallback a whatsapp_config.doctors[id] (formato global single window)
  if (!isDayActive && dayBlocks.length === 0 && docConfig) {
    const dayNum = date.getDay()
    if (docConfig.days.includes(dayNum)) {
      isDayActive = true
      dayBlocks = [{ start: docConfig.start, end: docConfig.end }]
    }
  }

  // 3) Fallback a clinic.working_hours
  if (!isDayActive && dayBlocks.length === 0) {
    const clinicHours = normalizeWorkingHours(clinic.working_hours)
    const dayCfg = clinicHours[dayKey]
    if (dayCfg.active && dayCfg.blocks.length > 0) {
      isDayActive = true
      dayBlocks = dayCfg.blocks
    }
  }

  if (!isDayActive || dayBlocks.length === 0) {
    const dow = spanishDayOfWeek(dateStr)
    return {
      success: true,
      data: {
        available: false,
        date: dateStr,
        dayOfWeek: dow,
        reason: `El doctor no atiende ese día (${dow})`,
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
    .select('starts_at, ends_at')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .gte('starts_at', dayStart)
    .lte('starts_at', dayEnd)
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[check_availability] Error DB:', error)
    return { success: false, error: 'Error consultando disponibilidad' }
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

  // Filtrar los que ya están ocupados
  const occupiedTimes = new Set(
    (existingAppointments ?? []).map((apt) => apt.starts_at)
  )

  // Filtrar ocupados + slots que caen dentro de la ventana de anticipación mínima
  const earliestAllowedISO = earliestAllowed.toISOString()
  const availableSlots = allSlots.filter((slot) => {
    if (occupiedTimes.has(slot.utc)) return false
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
      doctor_name: doctor.name,
      slots: availableSlots.map((s) => ({
        time: s.display,
        starts_at: s.utc,
      })),
      total_available: availableSlots.length,
    },
  }
}

/**
 * Genera todos los slots de tiempo para un día
 * Ejemplo: de 8:00 a 18:00 con slots de 30 min = 20 slots
 */
function generateTimeSlots(
  dateStr: string,
  startTime: string,
  endTime: string,
  durationMinutes: number
): Array<{ utc: string; display: string }> {
  const slots: Array<{ utc: string; display: string }> = []

  // Crear fecha de inicio en hora Colombia
  const startDate = parseISO(`${dateStr}T${startTime}:00-05:00`)
  const endDate = parseISO(`${dateStr}T${endTime}:00-05:00`)

  let current = startDate
  while (current < endDate) {
    const slotEnd = addMinutes(current, durationMinutes)
    // Solo agregar si el slot completo cabe antes del cierre
    if (slotEnd <= endDate) {
      slots.push({
        utc: current.toISOString(),
        display: formatTimeForPatient(current.toISOString()),
      })
    }
    current = addMinutes(current, durationMinutes)
  }

  return slots
}

// ============================================================
// CREATE APPOINTMENT — Crear cita nueva
// ============================================================
async function createAppointment(
  input: Record<string, unknown>,
  clinicId: string,
  clinic: Clinic
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
  const consultationTypeId = (input.consultation_type_id as string) ?? null
  const modality = (input.modality as string) ?? 'presencial'
  const freeTextReason = (input.free_text_reason as string) ?? null

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
      return { success: false, error: 'Ese tipo de consulta no corresponde al doctor seleccionado. Pregunta al paciente qué tipo de consulta necesita con este doctor.' }
    }
    duration = ctData.duration_minutes
  }

  const endsAt = calculateEndTime(startsAt, duration)

  // Verificar que no haya otra cita en ese horario (doble booking)
  const { data: conflict } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .lt('starts_at', endsAt)
    .gt('ends_at', startsAt)
    .limit(1)

  if (conflict && conflict.length > 0) {
    return {
      success: false,
      error: 'SLOT_JUST_TAKEN — Ese horario se acaba de ocupar por otra persona mientras el paciente esperaba. DEBES: (1) disculparte: "Disculpa, ese horario se acaba de ocupar mientras hablábamos" (2) usar check_availability para buscar alternativas cercanas (3) ofrecer 2-3 opciones nuevas. NUNCA actúes como si nunca hubieras propuesto el horario original.',
    }
  }

  // Buscar o crear paciente
  let { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id')
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
      })
      .select('id')
      .single()

    if (patientError) {
      console.error('[create_appointment] Error creando paciente:', patientError)
      return { success: false, error: 'Error registrando al paciente' }
    }
    patient = newPatient
  } else {
    // Si el paciente ya existe, actualizar todos los datos que llegaron
    await supabaseAdmin
      .from('patients')
      .update({
        name: patientName,
        ...(dateOfBirth && { date_of_birth: dateOfBirth }),
        ...(documentType && { document_type: documentType }),
        ...(documentNumber && { document_number: documentNumber }),
        ...(patientEmail && { email: patientEmail }),
        ...(patientEps && { eps: patientEps }),
      })
      .eq('id', patient.id)
  }

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
  clinic: Clinic
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

  const insurerTypeFilter = input.insurer_type === 'EPS' || input.insurer_type === 'Prepagada'
    ? input.insurer_type as 'EPS' | 'Prepagada'
    : null

  // Normalizar para búsqueda flexible
  const searchTerm = epsName.toLowerCase()

  // Buscar en consultation_types.eps_name (convenios importados de iSalud)
  let query = supabaseAdmin
    .from('consultation_types')
    .select('eps_name, insurer_type')
    .eq('clinic_id', clinicId)
    .not('eps_name', 'is', null)
  if (insurerTypeFilter) {
    query = query.eq('insurer_type', insurerTypeFilter)
  }
  const { data: matches } = await query

  // Match flexible: partial match case-insensitive
  type Row = { eps_name: string; insurer_type: 'EPS' | 'Prepagada' | null }
  const rows = (matches ?? []) as Row[]
  const found = rows.find((r) => {
    const lower = r.eps_name.toLowerCase()
    return lower.includes(searchTerm) || searchTerm.includes(lower.replace(/[.\s]+/g, ''))
  })

  // También buscar en isalud_import_staging (puede haber convenios no importados aún)
  // Solo si no se filtró por insurer_type — staging no tiene clasificación
  if (!found && !insurerTypeFilter) {
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
      },
    }
  }

  // No encontrado — listar los que SÍ tiene para referencia (filtrados por tipo si aplica)
  const uniqueAvailable = [...new Set(rows.map((r) => r.eps_name))]
  return {
    success: true,
    data: {
      hasConvenio: false,
      epsSearched: epsName,
      insurerTypeFilter,
      availableConvenios: uniqueAvailable.slice(0, 10),
      message: insurerTypeFilter
        ? `No se encontró convenio ${insurerTypeFilter} con "${epsName}". Informa al paciente y ofrece particular.`
        : `No se encontró convenio con "${epsName}". Informa al paciente y ofrece agendar como particular.`,
    },
  }
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
