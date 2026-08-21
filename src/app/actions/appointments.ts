'use server'

// ============================================================
// Server Actions — Mutaciones de citas desde el dashboard
// Cada acción filtra SIEMPRE por clinic_id (seguridad)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import type { PaymentType, AttendanceOutcome } from '@/types/database'
import { getSessionClinicId, checkWritePermission } from '@/lib/actions-helpers'
import { computeNoShowDelta } from '@/lib/utils/attendance-outcome'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserSession } from '@/lib/session'
import { traerDisponibilidadDia } from '@/lib/calendar/fetch-day-availability'
import { estadoDeFranja, motivoParaConfirmar, type EstadoFranja } from '@/lib/calendar/day-availability'
import { notifyAppointmentMoved, notifyAppointmentCreated } from '@/lib/appointment-move-notify'

// ============================================================
// Marcado de asistencia (campo attendance_outcome — migración 00073)
//
// Estados modelados según columna FASE del export iSalud:
//   NULL          = "Programado" (estado inicial, nadie lo marca)
//   'admitido'    = paciente llegó y se admitió
//   'facturado'   = consulta facturada
//   'inasistente' = paciente no se presentó
//
// Garantías:
//   - Idempotencia: marcar 2× el mismo estado NO duplica no_show_count
//   - Revertir 'inasistente' → NULL decrementa no_show_count
//   - Cambiar de 'inasistente' a otro outcome decrementa no_show_count
//   - Cambiar de otro outcome a 'inasistente' incrementa no_show_count
//   - Marcar 'facturado' recalcula visit frequency
// ============================================================

async function adjustNoShowCount(
  appointmentId: string,
  clinicId: string,
  delta: 1 | -1,
): Promise<void> {
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('patient_id')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()

  if (!apt?.patient_id) return

  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('no_show_count')
    .eq('id', apt.patient_id)
    .eq('clinic_id', clinicId)
    .single()

  if (!patient) return

  const current = patient.no_show_count ?? 0
  const next = delta === 1 ? current + 1 : Math.max(0, current - 1)

  await supabaseAdmin
    .from('patients')
    .update({ no_show_count: next })
    .eq('id', apt.patient_id)
    .eq('clinic_id', clinicId)
}

async function setAttendanceOutcomeInternal(
  appointmentId: string,
  next: AttendanceOutcome | null,
): Promise<{ clinicId: string; previous: AttendanceOutcome | null }> {
  const clinicId = await getSessionClinicId()

  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('attendance_outcome')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()

  if (!apt) throw new Error('Cita no encontrada')

  const previous = (apt.attendance_outcome ?? null) as AttendanceOutcome | null

  if (previous === next) return { clinicId, previous }

  const { error } = await supabaseAdmin
    .from('appointments')
    .update({ attendance_outcome: next, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  if (error) throw new Error('Error actualizando cita')

  const delta = computeNoShowDelta(previous, next)
  if (delta !== 0) {
    await adjustNoShowCount(appointmentId, clinicId, delta)
  }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: next ? `attendance_marked_${next}` : 'attendance_reverted',
    actor_type: 'staff',
    target_type: 'appointment',
    target_id: appointmentId,
    details: { previous },
  })

  revalidatePath('/dashboard')
  if (next === 'inasistente' || previous === 'inasistente') {
    revalidatePath('/dashboard/noshow')
  }

  return { clinicId, previous }
}

/** Marcar cita como ADMITIDA — paciente llegó al consultorio */
export async function markAsAdmitido(appointmentId: string): Promise<void> {
  await setAttendanceOutcomeInternal(appointmentId, 'admitido')
}

/**
 * Marcar cita como FACTURADA.
 *
 * En Omuwan el único rol de este botón es DISPARAR LA ENCUESTA — la facturación
 * real vive en el HIS. Y el equipo lo marca apenas la paciente sale, así que la
 * encuesta sale acá mismo en vez de esperar hasta 59 minutos a la corrida del
 * cron.
 *
 * El envío va dentro de `after()`: corre DESPUÉS de responderle al navegador,
 * así que el click no espera el round-trip a Meta. Si el envío falla, la
 * secretaria no lo ve en el momento — queda en audit_log y el cron reintenta.
 */
export async function markAsFacturado(appointmentId: string): Promise<void> {
  const { clinicId, previous } = await setAttendanceOutcomeInternal(appointmentId, 'facturado')

  // Solo en la TRANSICIÓN a facturado. Re-marcar una cita ya facturada no
  // reintenta el envío: de eso se encarga el cron con su propia idempotencia.
  if (previous !== 'facturado') {
    after(async () => {
      const { sendSurveyNow } = await import('@/lib/survey/send-survey-now')
      const r = await sendSurveyNow(appointmentId, clinicId)
      if (!r.sent) console.log(`[markAsFacturado] encuesta no enviada (${r.reason}) — queda para el cron`)
    })
  }

  if (previous !== 'facturado') {
    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('patient_id')
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .single()

    if (apt?.patient_id) {
      try {
        const { calculateVisitFrequency } = await import('@/app/actions/reactivation')
        await calculateVisitFrequency(apt.patient_id, clinicId)
      } catch {
        // No bloquear la operación principal
      }
    }
  }
}

/** Marcar cita como INASISTENTE — paciente no se presentó */
export async function markAsInasistente(appointmentId: string): Promise<void> {
  await setAttendanceOutcomeInternal(appointmentId, 'inasistente')
}

/** Revertir asistencia a NULL ("Programado") — ajusta no_show_count si aplica */
export async function revertAttendanceOutcome(appointmentId: string): Promise<void> {
  await setAttendanceOutcomeInternal(appointmentId, null)
}

/** Actualizar tipo de pago de una cita */
export async function updatePaymentType(
  appointmentId: string,
  paymentType: PaymentType
): Promise<void> {
  const clinicId = await getSessionClinicId()

  const { error } = await supabaseAdmin
    .from('appointments')
    .update({ payment_type: paymentType, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  if (error) throw new Error('Error actualizando tipo de pago')

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'payment_type_updated',
    actor_type: 'staff',
    target_type: 'appointment',
    target_id: appointmentId,
    details: { payment_type: paymentType },
  })

  revalidatePath('/dashboard')
}

// ============================================================
// Crear cita desde dashboard
// ============================================================

export interface AppointmentInput {
  patient_id: string
  doctor_id: string
  starts_at: string         // ISO 8601 con -05:00
  duration_minutes: number
  reason: string
  payment_type: PaymentType
  eps_name: string
  modality?: 'presencial' | 'virtual'
  virtual_link?: string | null
  desired_at?: string | null  // YYYY-MM-DD, fecha que quería el paciente
  /** ¿Se le avisa a la paciente que le agendamos? Default: SÍ.
   *
   *  El silencio existe porque el caso legítimo existe —la secretaria carga la
   *  cita de alguien que acaba de llamar, y ahí el aviso ya ocurrió en la
   *  llamada— pero es una casilla que se DESMARCA, no el default. Hasta el
   *  2026-08-20 no había aviso por ningún camino: dos pacientes quedaron
   *  agendadas para septiembre sin enterarse. */
  notificar_paciente?: boolean
  /** Obligatorio si se agenda en silencio: por qué no hace falta avisar. */
  motivo_sin_aviso?: string
  /** Frase extra para la paciente ("el doctor pidió control en un mes"). */
  motivo_para_paciente?: string | null
  /** La secretaria vio QUIÉN ocupa el cupo y confirmó agendar un EXTRA igual.
   *  Un extra existe porque el médico lo autorizó ese día — eso no lo puede
   *  saber el sistema, y por eso hace falta el acto explícito de una persona. */
  extra_confirmado?: boolean
  /** La secretaria vio la advertencia de "fuera de horario" y confirmó igual.
   *  Sin esto, el server RECHAZA una cita fuera de franja: la advertencia del
   *  cliente sola no es una garantía —un submit directo la saltea— y acá el
   *  costo de saltearla es una paciente que llega a un consultorio vacío. */
  fuera_de_horario_confirmado?: boolean
  /** La fila del catálogo. Es lo que le da a la cita precio, duración y reglas
   *  —lo mismo que una del agente— en vez de un `reason` en texto libre.
   *
   *  Hasta el 2026-08-21 el panel NO lo guardaba: de las 10 citas que creó, las
   *  10 quedaron sin tipo. Una cita sin `consultation_type_id` no tiene precio,
   *  ni duración real, ni reglas aplicables, ni dato reportable. */
  consultation_type_id?: string | null
  /** Convenio que la clínica todavía no tiene cargado en ningún servicio.
   *
   *  El desplegable sale de los `eps_name` que YA existen, así que un convenio
   *  nuevo no aparece en ninguna lista. Antes de esto la secretaria no tenía
   *  salida: o elegía uno que no era —fabricando un precio— o dejaba la cita sin
   *  tipo. Ahora se guarda con el tipo PARTICULAR, el convenio queda escrito, y
   *  la clínica se entera de lo que le falta cargar. */
  convenio_no_listado?: string | null
}

/** Crear cita desde el dashboard */
export async function createAppointment(
  input: AppointmentInput
): Promise<{ ok: boolean; error?: string; warning?: string; whatsappSent?: boolean }> {
  try {
    const clinicId = await checkWritePermission('agenda')

    // Mismo patrón que cancelar y editar: avisar es el default y el silencio
    // cuesta un motivo. Una cita que la paciente no sabe que tiene es una
    // paciente que no viene, o que aparece cuando nadie la espera.
    const notificar = input.notificar_paciente !== false
    if (!notificar && !input.motivo_sin_aviso?.trim()) {
      return { ok: false, error: 'Agendar sin avisarle a la paciente exige un motivo.' }
    }

    if (!input.patient_id) return { ok: false, error: 'Selecciona un paciente' }
    if (!input.doctor_id) return { ok: false, error: 'Selecciona un doctor' }
    if (!input.starts_at) return { ok: false, error: 'Selecciona fecha y hora' }

    const startsAt = new Date(input.starts_at)
    // ── EL TIPO DE CONSULTA MANDA SOBRE LA DURACIÓN ──────────────────
    //
    // Si vino un tipo, su duración es la buena: es la que el catálogo dice que
    // ocupa ese servicio, y la misma que usa el agente. `duration_minutes` del
    // formulario queda como OVERRIDE explícito —la secretaria puede necesitar
    // 60 para algo que el catálogo cree de 30— pero sólo si difiere del tipo.
    let duracionFinal = input.duration_minutes || 30
    if (input.consultation_type_id) {
      const { data: ct } = await supabaseAdmin
        .from('consultation_types')
        .select('id, duration_minutes, doctor_id, name')
        .eq('id', input.consultation_type_id)
        .eq('clinic_id', clinicId)
        .maybeSingle()

      if (!ct) return { ok: false, error: 'Ese servicio no existe en el catálogo de la clínica' }

      // El servicio tiene que ser DE ESE MÉDICO. Mismo backstop que el executor
      // (BLOCKED_BY_DOCTOR_PIN_SERVICE): un servicio de otro médico deja la cita
      // con un precio y unas reglas que no le corresponden.
      if (ct.doctor_id && ct.doctor_id !== input.doctor_id) {
        return { ok: false, error: `"${ct.name}" no es un servicio de ese médico. Elige otro servicio o cambia el médico.` }
      }
      // Sin override explícito, manda el catálogo.
      if (!input.duration_minutes) duracionFinal = ct.duration_minutes
    }

    const endsAt = new Date(startsAt.getTime() + duracionFinal * 60 * 1000)

    // ── ¿Cae fuera de la franja del médico? ────────────────────────────
    // Se resuelve con la MISMA fuente que pinta la grilla y que usa el agente,
    // así que lo que la secretaria vio en verde es lo que acá pasa sin fricción.
    const fechaCot = formatInTimeZone(startsAt, 'America/Bogota', 'yyyy-MM-dd')
    const horaCot = formatInTimeZone(startsAt, 'America/Bogota', 'HH:mm')
    const { data: clinicHoras } = await supabaseAdmin
      .from('clinics').select('working_hours, whatsapp_config, operational_status, operational_status_message').eq('id', clinicId).single()

    let estadoFranja: EstadoFranja = 'disponible'
    let motivoFuera = ''
    if (clinicHoras) {
      const disp = await traerDisponibilidadDia(clinicId, input.doctor_id, fechaCot, clinicHoras)
      estadoFranja = estadoDeFranja(disp, horaCot)
      if (estadoFranja !== 'disponible') {
        const { data: doc } = await supabaseAdmin
          .from('doctors').select('name').eq('id', input.doctor_id).maybeSingle()
        motivoFuera = motivoParaConfirmar(disp, doc?.name ?? 'El médico')
      }
    }

    // El flag NO es una formalidad: es la única barrera del lado del servidor.
    if (estadoFranja !== 'disponible' && !input.fuera_de_horario_confirmado) {
      return { ok: false, error: `FUERA_DE_HORARIO: ${motivoFuera}` }
    }

    // ── ¿El cupo ya está ocupado? ─────────────────────────────────────
    // Antes esto era un `return` seco. Pero las secretarias necesitan agendar
    // EXTRAS: pacientes que el médico autoriza atender ese mismo día. En iSalud
    // lo hacen poniendo dos en el mismo bloque, y el sync ya trae 404 filas así.
    //
    // Mismo patrón que "fuera de horario": se advierte QUIÉN está en ese cupo y
    // una persona decide. No se bloquea —la clínica lo hace igual, con o sin
    // nosotros— pero tampoco se deja pasar en silencio.
    //
    // ⚖️ POR RANGO Y NO POR HORA EXACTA — decidido con datos, 2026-08-19.
    // El riesgo de un chequeo por rango es que salte tan seguido que se
    // clickee sin leer, y ahí se pierde la protección. Medido sobre las 106
    // citas de la semana del 17/08:
    //     por rango       → 22 cupos (20,8%)
    //     por hora exacta → 18 cupos (17,0%)
    //     diferencia      →  4 cupos (3,8%)
    // No dispara "siempre": 4 de cada 5 veces no aparece nada. Y los 4 casos
    // que sólo el rango atrapa son solapes REALES (citas de 30 min que arrancan
    // 20 después de otra, pisando al médico 10 minutos) — justo lo que la
    // secretaria querría ver. Con hora exacta pasarían en silencio.
    //
    // CUÁNDO REVISARLO: si la clínica empieza a agendar en cupos MÁS CORTOS que
    // la duración de la consulta, ese 20,8% se dispara y el aviso se vuelve
    // papel tapiz. Hoy ningún médico está así (duración ≤ separación en los 7).
    // Vale la pena re-correr la medición en un mes.
    const { data: conflict } = await supabaseAdmin
      .from('appointments')
      .select('id, starts_at, patients(name), consultation_types(name)')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', input.doctor_id)
      .in('status', ['confirmed', 'rescheduled'])
      .lt('starts_at', endsAt.toISOString())
      .gt('ends_at', startsAt.toISOString())
      .limit(1)

    const chocaCon = conflict?.[0] ?? null
    if (chocaCon && !input.extra_confirmado) {
      const ocupante = (Array.isArray(chocaCon.patients) ? chocaCon.patients[0] : chocaCon.patients) as { name: string } | null
      const hora = formatInTimeZone(new Date(chocaCon.starts_at as string), 'America/Bogota', 'h:mm a')
      // El nombre va en el mensaje a propósito: la secretaria tiene que poder
      // ver contra QUIÉN está agendando antes de confirmar.
      return {
        ok: false,
        error: `CUPO_OCUPADO: Ya hay una cita a las ${hora} con ${ocupante?.name ?? 'otra paciente'}. ¿Agendar de todos modos como extra?`,
      }
    }

    // Un extra convive con la cita original gracias a que el índice único
    // `idx_appointments_no_double_booking` es PARCIAL: sólo cubre confirmed y
    // rescheduled. Es el mismo mecanismo que usa el sync de iSalud al degradar.
    // Y como blocked_external está en BUSY_STATUSES, el AGENTE lo sigue viendo
    // ocupado: nunca va a ofrecer ese cupo por su cuenta.
    const esExtra = Boolean(chocaCon && input.extra_confirmado)

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        doctor_id: input.doctor_id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: esExtra ? 'blocked_external' : 'confirmed',
        reason: input.reason.trim() || null,
        consultation_type_id: input.consultation_type_id || null,
        payment_type: input.payment_type || null,
        // El convenio no listado también va acá: es el dato real de quién paga,
        // aunque no exista como fila del catálogo.
        eps_name: input.convenio_no_listado?.trim()
          || (input.payment_type === 'EPS' ? (input.eps_name || null) : null),
        source: 'dashboard',
        modality: input.modality ?? 'presencial',
        virtual_link: input.virtual_link ?? null,
        desired_at: input.desired_at || null,
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: 'Error creando cita' }

    // Un extra es una decisión de una persona sobre un cupo que ya estaba
    // ocupado: tiene que quedar QUIÉN lo hizo y contra qué cita.
    if (esExtra) {
      try {
        const sesion = await getUserSession()
        await supabaseAdmin.from('audit_log').insert({
          clinic_id: clinicId,
          action: 'appointment_extra_created',
          actor_type: 'staff',
          actor_id: sesion?.clinicUserId ?? null,
          target_type: 'appointment',
          target_id: data.id,
          details: {
            choca_con_appointment_id: chocaCon?.id ?? null,
            doctor_id: input.doctor_id,
            starts_at: startsAt.toISOString(),
            creado_por: sesion?.fullName ?? null,
            nota: 'Cupo ya ocupado; la secretaria confirmó agendar un extra',
          },
        })
      } catch { /* no bloquear la creación por el registro */ }
    }

    // Incrementar total_appointments del paciente
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('total_appointments')
      .eq('id', input.patient_id)
      .eq('clinic_id', clinicId)
      .single()

    if (patient) {
      await supabaseAdmin
        .from('patients')
        .update({ total_appointments: (patient.total_appointments ?? 0) + 1 })
        .eq('id', input.patient_id)
        .eq('clinic_id', clinicId)
    }

    // ── EL CONVENIO QUE LA CLÍNICA NO TIENE CARGADO ─────────────────
    //
    // Se marca en la CONVERSACIÓN de la paciente, para que aparezca en la
    // pestaña Servicios — que es donde ellas ya miran lo que falta gestionar.
    //
    // ⚠️ Si la paciente no tiene conversación, el pendiente no tiene dónde
    // vivir: la marca es por conversación, no por cita. Medido: 9 de las 10
    // citas del panel tienen conversación, 1 no. En ese caso queda el
    // audit_log y el convenio escrito en la cita, y el caller avisa.
    let convenioSinLugar = false
    if (input.convenio_no_listado?.trim()) {
      const convenio = input.convenio_no_listado.trim()
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id, context')
        .eq('clinic_id', clinicId)
        .eq('patient_id', input.patient_id)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()

      if (conv) {
        const ctx = (conv.context ?? {}) as Record<string, unknown>
        await supabaseAdmin.from('conversations').update({
          context: {
            ...ctx,
            convenio_no_listado: convenio,
            // Nunca se pisa: el reloj de la cola cuenta desde el PRIMER aviso.
            convenio_no_listado_at: (ctx.convenio_no_listado_at as string | undefined) ?? new Date().toISOString(),
          },
        }).eq('id', conv.id).eq('clinic_id', clinicId)
      } else {
        convenioSinLugar = true
      }

      const sessionConv = await getUserSession()
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'convenio_no_listado_registrado',
        actor_type: 'staff',
        target_type: 'appointment',
        target_id: data.id,
        details: {
          convenio,
          en_conversacion: !convenioSinLugar,
          usuario_id: sessionConv?.clinicUserId ?? null,
          usuario_nombre: sessionConv?.fullName ?? null,
        },
      })
    }

    // Queda registro de QUIÉN forzó una cita fuera de franja y por qué estaba
    // cerrado. Es lo que después contesta "¿esto fue un error o una decisión?".
    if (estadoFranja !== 'disponible') {
      const session = await getUserSession()
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'cita_fuera_de_horario_confirmada',
        actor_type: 'staff',
        target_type: 'appointment',
        target_id: data.id,
        details: {
          doctor_id: input.doctor_id,
          fecha: fechaCot,
          hora: horaCot,
          estado: estadoFranja,          // 'fuera_de_horario' | 'bloqueado'
          motivo: motivoFuera,
          usuario_id: session?.clinicUserId ?? null,
          usuario_nombre: session?.fullName ?? null,
        },
      })
    }

    // El aviso va DESPUÉS de que la cita existe: si el envío falla, la cita
    // igual quedó y el fallo queda registrado en Pendientes.
    let whatsappSent = false
    let warning: string | undefined
    if (convenioSinLugar) {
      warning = `Registramos el convenio "${input.convenio_no_listado?.trim()}" en la cita, pero esta paciente no tiene conversación abierta, así que no va a aparecer en la pestaña Servicios. Avísale a quien carga el catálogo.`
    }
    if (notificar) {
      const r = await notifyAppointmentCreated(data.id, clinicId, {
        motivoParaPaciente: input.motivo_para_paciente ?? null,
      })
      whatsappSent = r.whatsappSent
      warning = r.warning
    }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: notificar ? 'appointment_created_dashboard' : 'appointment_created_silently',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: data.id,
      details: {
        starts_at: startsAt.toISOString(),
        doctor_id: input.doctor_id,
        aviso_a_paciente: notificar ? (whatsappSent ? 'entregado' : 'falló') : 'en silencio',
        motivo_sin_aviso: input.motivo_sin_aviso?.trim() || null,
      },
    })

    revalidatePath('/dashboard')
    return { ok: true, warning, whatsappSent }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * Cancelar una cita desde el panel. `notificar` decide si la paciente se entera.
 *
 * UN solo camino: antes convivían tres implementaciones de "cancelar una cita"
 * y ya divergían entre sí. Acá sólo se resuelve el permiso y el actor; la
 * lógica vive en cancelAndNotifyPatient.
 *
 * notificar=false es para el staff (citas duplicadas, creadas por error,
 * correcciones internas) y EXIGE motivo — se valida abajo y otra vez en
 * cancel-notify, porque el gate no puede depender de la pantalla.
 */
export async function cancelAppointmentFromPanel(
  appointmentId: string,
  internalReason: string,
  patientReason?: string | null,
  notificar: boolean = true,
): Promise<{ ok: boolean; error?: string; whatsappSent?: boolean; warning?: string }> {
  try {
    const clinicId = await checkWritePermission('agenda')
    if (!notificar && !internalReason.trim()) {
      return { ok: false, error: 'Para cancelar sin avisar a la paciente hay que dejar el motivo.' }
    }
    let actorId: string | null = null
    try {
      const supabase = await createSupabaseServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      actorId = user?.id ?? null
    } catch { /* el actor es deseable, no bloqueante */ }

    const { cancelAndNotifyPatient } = await import('@/lib/cancel-notify')
    const result = await cancelAndNotifyPatient(
      appointmentId, clinicId, internalReason, patientReason, { notificar, actorId },
    )
    revalidatePath('/dashboard')
    return { ok: result.ok, whatsappSent: result.whatsappSent, warning: result.warning }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Actualizar cita desde el dashboard */
/** Lo que la secretaria decide sobre el aviso cuando mueve una cita. */
export interface EdicionOpts {
  /** Default: avisar. En false exige motivo interno, igual que cancelar. */
  notificar?: boolean
  motivoInterno?: string
  motivoParaPaciente?: string | null
}

/** Campos cuyo cambio la paciente TIENE que saber: es a dónde y con quién ir. */
const CAMPOS_QUE_SE_AVISAN = ['starts_at', 'doctor_id'] as const

export async function updateAppointmentFromDashboard(
  appointmentId: string,
  input: AppointmentInput,
  opts?: EdicionOpts,
): Promise<{ ok: boolean; error?: string; warning?: string; whatsappSent?: boolean }> {
  try {
    const clinicId = await checkWritePermission('agenda')

    // Estado ANTES: hace falta para el diff del audit y para saber si el cambio
    // es de los que la paciente tiene que saber.
    const { data: antes } = await supabaseAdmin
      .from('appointments')
      .select('starts_at, ends_at, doctor_id, patient_id, reason, payment_type, eps_name, modality, virtual_link, reminder_confirmed, calendar_sequence, status')
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .single()
    if (!antes) return { ok: false, error: 'Cita no encontrada' }

    const startsAt = new Date(input.starts_at)
    const endsAt = new Date(startsAt.getTime() + (input.duration_minutes || 30) * 60 * 1000)

    const cambioHorario = new Date(antes.starts_at as string).getTime() !== startsAt.getTime()
    const cambioMedico = (antes.doctor_id as string) !== input.doctor_id
    const hayQueAvisar = cambioHorario || cambioMedico

    // Mover una cita en silencio es peor que cancelarla con aviso: la paciente
    // llega el día que ya no es. El silencio existe, pero cuesta un motivo.
    const notificar = opts?.notificar !== false
    if (hayQueAvisar && !notificar && !opts?.motivoInterno?.trim()) {
      return { ok: false, error: 'Mover una cita sin avisarle a la paciente exige un motivo.' }
    }

    // ── Mismas reglas que agendar ──────────────────────────────────────
    // Se resuelve con la MISMA fuente que pinta la grilla y que usa el agente.
    // Una cita movida a una hora que el médico no atiende manda a la paciente a
    // un consultorio vacío, igual que una creada ahí.
    if (cambioHorario || cambioMedico) {
      const fechaCot = formatInTimeZone(startsAt, 'America/Bogota', 'yyyy-MM-dd')
      const horaCot = formatInTimeZone(startsAt, 'America/Bogota', 'HH:mm')
      const { data: clinicHoras } = await supabaseAdmin
        .from('clinics').select('working_hours, whatsapp_config, operational_status, operational_status_message').eq('id', clinicId).single()
      if (clinicHoras) {
        const disp = await traerDisponibilidadDia(clinicId, input.doctor_id, fechaCot, clinicHoras)
        const estadoFranja = estadoDeFranja(disp, horaCot)
        if (estadoFranja !== 'disponible') {
          const { data: doc } = await supabaseAdmin
            .from('doctors').select('name').eq('id', input.doctor_id).maybeSingle()
          const motivoFueraUpd = motivoParaConfirmar(disp, doc?.name ?? 'El médico')
          if (!input.fuera_de_horario_confirmado) {
            return { ok: false, error: `FUERA_DE_HORARIO: ${motivoFueraUpd}` }
          }
          // Confirmado: queda el registro, igual que al crear. Mover una cita a
          // un horario cerrado es la misma decisión que crearla ahí, y hasta
          // ahora este camino no dejaba rastro de quién la tomó.
          const sessionUpd = await getUserSession()
          await supabaseAdmin.from('audit_log').insert({
            clinic_id: clinicId,
            action: 'cita_fuera_de_horario_confirmada',
            actor_type: 'staff',
            target_type: 'appointment',
            target_id: appointmentId,
            details: {
              doctor_id: input.doctor_id,
              fecha: fechaCot,
              hora: horaCot,
              estado: estadoFranja,
              motivo: motivoFueraUpd,
              al_editar: true,
              usuario_id: sessionUpd?.clinicUserId ?? null,
              usuario_nombre: sessionUpd?.fullName ?? null,
            },
          })
        }
      }
    }

    // Cupo ocupado (excluyendo esta cita).
    const { data: conflict } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', input.doctor_id)
      .in('status', ['confirmed', 'rescheduled'])
      .neq('id', appointmentId)
      .lt('starts_at', endsAt.toISOString())
      .gt('ends_at', startsAt.toISOString())
      .limit(1)
    if (conflict && conflict.length > 0) {
      return { ok: false, error: 'Ya hay una cita en ese horario con ese doctor' }
    }

    // La paciente había confirmado la cita VIEJA. Al mover la hora esa
    // confirmación deja de valer, y hay que decírselo (ver `debeReconfirmar`):
    // si no, se queda pensando que ya está.
    const habiaConfirmado = antes.reminder_confirmed === true
    const debeReconfirmar = cambioHorario && habiaConfirmado

    const cambios: Record<string, unknown> = {
      patient_id: input.patient_id,
      doctor_id: input.doctor_id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reason: input.reason.trim() || null,
      payment_type: input.payment_type || null,
      eps_name: input.payment_type === 'EPS' ? (input.eps_name || null) : null,
      modality: input.modality ?? 'presencial',
      virtual_link: input.virtual_link ?? null,
      desired_at: input.desired_at || null,
      updated_at: new Date().toISOString(),
    }

    if (cambioHorario) {
      // Los recordatorios se buscan por ventana de tiempo sobre starts_at Y por
      // flag: si el flag queda en true, la cita movida NUNCA recibe el
      // recordatorio de su hora nueva. Y `reminder_confirmed` no null la deja
      // fuera de handleReminderResponse, así que su botón tampoco funcionaría.
      cambios.reminder_72h_sent = false
      cambios.reminder_24h_sent = false
      cambios.reminder_2h_sent = false
      cambios.reminder_confirmed = null
      cambios.confirmation_received = false
    }
    if (hayQueAvisar) {
      // Mismo UID (es un UPDATE, el id no cambia) + SEQUENCE más alto = el
      // evento que la paciente ya tiene se MUEVE, en vez de duplicarse.
      cambios.calendar_sequence = ((antes.calendar_sequence as number) ?? 0) + 1
    }

    const { error } = await supabaseAdmin
      .from('appointments').update(cambios).eq('id', appointmentId).eq('clinic_id', clinicId)
    if (error) return { ok: false, error: 'Error actualizando cita' }

    // Auditoría con ANTES y DESPUÉS. Esta pantalla puede cambiar hora, médico y
    // precio: sin el diff, "¿quién movió esta cita y desde dónde?" no tiene
    // respuesta. Sólo se listan los campos que efectivamente cambiaron.
    const diff: Record<string, { antes: unknown; despues: unknown }> = {}
    const comparables: [string, unknown, unknown][] = [
      ['starts_at', antes.starts_at, cambios.starts_at],
      ['doctor_id', antes.doctor_id, input.doctor_id],
      ['patient_id', antes.patient_id, input.patient_id],
      ['reason', antes.reason, cambios.reason],
      ['payment_type', antes.payment_type, cambios.payment_type],
      ['eps_name', antes.eps_name, cambios.eps_name],
      ['modality', antes.modality, cambios.modality],
    ]
    for (const [campo, viejo, nuevo] of comparables) {
      if ((viejo ?? null) !== (nuevo ?? null)) diff[campo] = { antes: viejo ?? null, despues: nuevo ?? null }
    }

    let whatsappSent = false
    let warning: string | undefined

    if (hayQueAvisar && notificar) {
      const r = await notifyAppointmentMoved(appointmentId, clinicId, {
        motivoParaPaciente: opts?.motivoParaPaciente ?? null,
        debeReconfirmar,
      })
      whatsappSent = r.whatsappSent
      warning = r.warning
    } else if (hayQueAvisar && debeReconfirmar) {
      warning = 'La cita se movió sin avisar y la paciente ya la había confirmado: su confirmación se borró y no lo sabe.'
    }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: hayQueAvisar && !notificar ? 'appointment_moved_silently' : 'appointment_updated_dashboard',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: appointmentId,
      details: {
        cambios: diff,
        aviso_a_paciente: hayQueAvisar ? (notificar ? (whatsappSent ? 'entregado' : 'falló') : 'en silencio') : 'no hacía falta',
        motivo_interno: opts?.motivoInterno?.trim() || null,
        recordatorios_reseteados: cambioHorario,
        debia_reconfirmar: debeReconfirmar,
      },
    })

    revalidatePath('/dashboard')
    return { ok: true, warning, whatsappSent }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Fetch a single appointment with patient+doctor joins for realtime calendar */
export async function getAppointmentForCalendar(appointmentId: string) {
  const clinicId = await getSessionClinicId()

  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, ends_at, status, attendance_outcome, reason, reminder_24h_sent, reminder_confirmed,
      payment_type, doctor_id, modality, virtual_link,
      documents_requested, documents_received, free_text_reason,
      patients(id, name, phone, no_show_probability, no_show_count, total_appointments, document_type, document_number, date_of_birth, doctor_notes, data_consent_at),
      doctors(name, specialty),
      consultation_types(name)
    `)
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  if (!apt) return null

  const raw = apt as Record<string, unknown>
  return {
    id: apt.id as string,
    starts_at: apt.starts_at as string,
    ends_at: apt.ends_at as string,
    status: apt.status as string,
    attendance_outcome: (raw.attendance_outcome as 'admitido' | 'facturado' | 'inasistente' | null) ?? null,
    reason: (apt.reason as string) ?? null,
    reminder_24h_sent: (apt.reminder_24h_sent as boolean) ?? false,
    reminder_confirmed: (raw.reminder_confirmed as boolean | null) ?? null,
    payment_type: (apt.payment_type as string) ?? 'Particular',
    modality: (raw.modality as string) ?? 'presencial',
    virtual_link: (raw.virtual_link as string) ?? null,
    documents_requested: (raw.documents_requested as boolean) ?? false,
    documents_received: (raw.documents_received as boolean) ?? false,
    free_text_reason: (raw.free_text_reason as string) ?? null,
    consultation_type_name: (raw.consultation_types as { name: string } | null)?.name ?? null,
    doctor_id: (raw.doctor_id as string) ?? null,
    patient: raw.patients as { id: string; name: string; phone: string; no_show_probability: number; no_show_count: number; total_appointments: number; document_type: string; document_number: string | null; date_of_birth: string | null; doctor_notes: string | null; data_consent_at: string | null } | null,
    doctor: raw.doctors as { name: string; specialty: string | null } | null,
  }
}
