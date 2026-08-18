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
  /** La secretaria vio la advertencia de "fuera de horario" y confirmó igual.
   *  Sin esto, el server RECHAZA una cita fuera de franja: la advertencia del
   *  cliente sola no es una garantía —un submit directo la saltea— y acá el
   *  costo de saltearla es una paciente que llega a un consultorio vacío. */
  fuera_de_horario_confirmado?: boolean
}

/** Crear cita desde el dashboard */
export async function createAppointment(
  input: AppointmentInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('agenda')

    if (!input.patient_id) return { ok: false, error: 'Selecciona un paciente' }
    if (!input.doctor_id) return { ok: false, error: 'Selecciona un doctor' }
    if (!input.starts_at) return { ok: false, error: 'Selecciona fecha y hora' }

    const startsAt = new Date(input.starts_at)
    const endsAt = new Date(startsAt.getTime() + (input.duration_minutes || 30) * 60 * 1000)

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

    // Verificar que no haya conflicto de horario con el mismo doctor
    const { data: conflict } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', input.doctor_id)
      .in('status', ['confirmed', 'rescheduled'])
      .lt('starts_at', endsAt.toISOString())
      .gt('ends_at', startsAt.toISOString())
      .limit(1)

    if (conflict && conflict.length > 0) {
      return { ok: false, error: 'Ya hay una cita en ese horario con ese doctor' }
    }

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        doctor_id: input.doctor_id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: 'confirmed',
        reason: input.reason.trim() || null,
        payment_type: input.payment_type || null,
        eps_name: input.payment_type === 'EPS' ? (input.eps_name || null) : null,
        source: 'dashboard',
        modality: input.modality ?? 'presencial',
        virtual_link: input.virtual_link ?? null,
        desired_at: input.desired_at || null,
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: 'Error creando cita' }

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

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'appointment_created_dashboard',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: data.id,
      details: { starts_at: startsAt.toISOString(), doctor_id: input.doctor_id },
    })

    revalidatePath('/dashboard')
    return { ok: true }
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
export async function updateAppointmentFromDashboard(
  appointmentId: string,
  input: AppointmentInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('agenda')

    const startsAt = new Date(input.starts_at)
    const endsAt = new Date(startsAt.getTime() + (input.duration_minutes || 30) * 60 * 1000)

    // Verificar conflicto (excluyendo la cita actual)
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

    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
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
      })
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando cita' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'appointment_updated_dashboard',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: appointmentId,
      details: { starts_at: startsAt.toISOString() },
    })

    revalidatePath('/dashboard')
    return { ok: true }
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
