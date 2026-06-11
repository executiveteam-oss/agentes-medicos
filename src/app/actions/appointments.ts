'use server'

// ============================================================
// Server Actions — Mutaciones de citas desde el dashboard
// Cada acción filtra SIEMPRE por clinic_id (seguridad)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { PaymentType, AttendanceOutcome } from '@/types/database'
import { getSessionClinicId, checkWritePermission } from '@/lib/actions-helpers'
import { computeNoShowDelta } from '@/lib/utils/attendance-outcome'

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

/** Marcar cita como FACTURADA — consulta cobrada/facturada */
export async function markAsFacturado(appointmentId: string): Promise<void> {
  const { clinicId, previous } = await setAttendanceOutcomeInternal(appointmentId, 'facturado')

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
        payment_type: input.payment_type || 'Particular',
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

/** Cancelar cita con motivo + notificar paciente prioritario en lista de espera */
export async function cancelAppointment(
  appointmentId: string,
  reason: string
): Promise<{ ok: boolean; error?: string; waitlistNotified?: string }> {
  try {
    const clinicId = await checkWritePermission('agenda')

    // Obtener info de la cita antes de cancelar (para doctor_id)
    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('doctor_id')
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .single()

    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error cancelando cita' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'appointment_cancelled_dashboard',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: appointmentId,
      details: { reason: reason.trim() },
    })

    // Notificar al paciente de mayor prioridad en lista de espera
    let waitlistNotified: string | undefined
    if (apt?.doctor_id) {
      try {
        const { notifyHighestPriorityWaitlistPatient } = await import('@/app/actions/priority')
        const result = await notifyHighestPriorityWaitlistPatient(clinicId, apt.doctor_id)
        if (result) waitlistNotified = result
      } catch {
        // No bloquear cancelación si falla la notificación
      }
    }

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/espera')
    return { ok: true, waitlistNotified }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Cancelar cita con notificación WhatsApp empática + opciones de reagendamiento */
export async function cancelAppointmentWithNotification(
  appointmentId: string,
  internalReason: string,
  patientReason?: string | null,
): Promise<{ ok: boolean; error?: string; whatsappSent?: boolean; warning?: string }> {
  try {
    const clinicId = await checkWritePermission('agenda')
    const { cancelAndNotifyPatient } = await import('@/lib/cancel-notify')
    const result = await cancelAndNotifyPatient(appointmentId, clinicId, internalReason, patientReason)
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
        payment_type: input.payment_type || 'Particular',
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
