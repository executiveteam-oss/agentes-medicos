'use server'

// ============================================================
// Server Actions — Mutaciones de citas desde el dashboard
// Cada acción filtra SIEMPRE por clinic_id (seguridad)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { PaymentType, InvoiceStatus } from '@/types/database'
import { getSessionClinicId, checkWritePermission } from '@/lib/actions-helpers'

/** Marcar cita como completada */
export async function markAppointmentCompleted(appointmentId: string): Promise<void> {
  const clinicId = await getSessionClinicId()

  const { error } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  if (error) throw new Error('Error actualizando cita')

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'appointment_completed',
    actor_type: 'staff',
    target_type: 'appointment',
    target_id: appointmentId,
    details: {},
  })

  revalidatePath('/dashboard')
}

/** Marcar cita como no-show */
export async function markAppointmentNoShow(appointmentId: string): Promise<void> {
  const clinicId = await getSessionClinicId()

  const { error } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'no_show', updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  if (error) throw new Error('Error actualizando cita')

  // Incrementar no_show_count del paciente
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('patient_id')
    .eq('id', appointmentId)
    .single()

  if (apt) {
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('no_show_count')
      .eq('id', apt.patient_id)
      .single()

    if (patient) {
      await supabaseAdmin
        .from('patients')
        .update({ no_show_count: (patient.no_show_count ?? 0) + 1 })
        .eq('id', apt.patient_id)
    }
  }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'appointment_no_show',
    actor_type: 'staff',
    target_type: 'appointment',
    target_id: appointmentId,
    details: {},
  })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/noshow')
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
  revalidatePath('/dashboard/facturacion')
}

/** Emitir factura para una cita */
export async function emitirFactura(appointmentId: string): Promise<void> {
  const clinicId = await getSessionClinicId()

  const { error } = await supabaseAdmin
    .from('appointments')
    .update({
      invoice_status: 'emitida' as InvoiceStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  if (error) throw new Error('Error emitiendo factura')

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'invoice_emitted',
    actor_type: 'staff',
    target_type: 'appointment',
    target_id: appointmentId,
    details: {},
  })

  revalidatePath('/dashboard/facturacion')
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
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: 'Error creando cita' }

    // Incrementar total_appointments del paciente
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('total_appointments')
      .eq('id', input.patient_id)
      .single()

    if (patient) {
      await supabaseAdmin
        .from('patients')
        .update({ total_appointments: (patient.total_appointments ?? 0) + 1 })
        .eq('id', input.patient_id)
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

/** Cancelar cita con motivo */
export async function cancelAppointment(
  appointmentId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('agenda')

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

    revalidatePath('/dashboard')
    return { ok: true }
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
