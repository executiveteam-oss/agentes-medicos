'use server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { cancelAndNotifyPatient } from '@/lib/cancel-notify'
import { revalidatePath } from 'next/cache'

export interface BlockedDate {
  id: string
  clinic_id: string
  doctor_id: string | null
  start_date: string
  end_date: string
  reason: string | null
  patient_reason: string | null
  created_at: string
}

export interface AffectedAppointment {
  id: string
  starts_at: string
  patient_name: string
  patient_phone: string
  doctor_name: string
  reason: string | null
}

export async function getBlockedDatesForDoctor(doctorId: string): Promise<BlockedDate[]> {
  const clinicId = await checkReadPermission('whatsapp')
  const { data } = await supabaseAdmin
    .from('blocked_dates')
    .select('*')
    .eq('clinic_id', clinicId)
    .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
    .order('start_date', { ascending: true })
  return (data ?? []) as BlockedDate[]
}

export async function getBlockedDatesForClinic(): Promise<BlockedDate[]> {
  const clinicId = await checkReadPermission('whatsapp')
  const { data } = await supabaseAdmin
    .from('blocked_dates')
    .select('*')
    .eq('clinic_id', clinicId)
    .is('doctor_id', null)
    .order('start_date', { ascending: true })
  return (data ?? []) as BlockedDate[]
}

/** Consultar citas que se verían afectadas por un bloqueo ANTES de crearlo */
export async function getAffectedAppointments(input: {
  doctorId?: string | null
  startDate: string
  endDate: string
}): Promise<AffectedAppointment[]> {
  const clinicId = await checkReadPermission('whatsapp')

  let query = supabaseAdmin
    .from('appointments')
    .select('id, starts_at, reason, doctor_id, patients(name, phone), doctors(name)')
    .eq('clinic_id', clinicId)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', `${input.startDate}T00:00:00-05:00`)
    .lte('starts_at', `${input.endDate}T23:59:59-05:00`)
    .order('starts_at')

  if (input.doctorId) {
    query = query.eq('doctor_id', input.doctorId)
  }

  const { data } = await query

  return (data ?? []).map((apt) => {
    const patient = (Array.isArray(apt.patients) ? apt.patients[0] : apt.patients) as { name: string; phone: string } | null
    const doctor = (Array.isArray(apt.doctors) ? apt.doctors[0] : apt.doctors) as { name: string } | null
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      patient_name: patient?.name ?? 'Paciente',
      patient_phone: patient?.phone ?? '',
      doctor_name: doctor?.name ?? 'Doctor',
      reason: apt.reason as string | null,
    }
  })
}

/** Crear bloqueo + cancelar citas afectadas + notificar pacientes */
export async function createBlockedDate(input: {
  doctorId?: string | null
  startDate: string
  endDate: string
  reason?: string | null
  patientReason?: string | null
  cancelAndNotify?: boolean
}): Promise<{ ok: boolean; error?: string; cancelled?: number; notified?: number }> {
  const clinicId = await checkWritePermission('whatsapp')
  if (!input.startDate || !input.endDate) return { ok: false, error: 'Fechas obligatorias' }
  if (input.endDate < input.startDate) return { ok: false, error: 'La fecha fin debe ser igual o posterior' }

  // 1. Guardar bloqueo
  const { error: insertErr } = await supabaseAdmin.from('blocked_dates').insert({
    clinic_id: clinicId,
    doctor_id: input.doctorId || null,
    start_date: input.startDate,
    end_date: input.endDate,
    reason: input.reason?.trim() || null,
    patient_reason: input.patientReason?.trim() || null,
  })
  if (insertErr) return { ok: false, error: 'Error creando bloqueo' }

  let cancelled = 0
  let notified = 0

  // 2. Si hay citas y el admin confirmó → cancelar + notificar
  if (input.cancelAndNotify) {
    const affected = await getAffectedAppointments({
      doctorId: input.doctorId,
      startDate: input.startDate,
      endDate: input.endDate,
    })

    if (affected.length > 0) {
      const internalReason = input.reason?.trim() || 'Fecha bloqueada'
      const patReason = input.patientReason?.trim() || null

      for (const apt of affected) {
        const result = await cancelAndNotifyPatient(apt.id, clinicId, internalReason, patReason)
        cancelled++
        if (result.whatsappSent) notified++
      }

      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'blocked_date_cancel_notify',
        actor_type: 'staff',
        details: { startDate: input.startDate, endDate: input.endDate, doctorId: input.doctorId, cancelled, notified, reason: input.reason },
      })
    }
  }

  revalidatePath('/dashboard/whatsapp')
  revalidatePath('/dashboard/settings/clinic')
  revalidatePath('/dashboard')
  return { ok: true, cancelled, notified }
}

export async function deleteBlockedDate(id: string): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await checkWritePermission('whatsapp')
  const { error } = await supabaseAdmin.from('blocked_dates').delete().eq('id', id).eq('clinic_id', clinicId)
  if (error) return { ok: false, error: 'Error eliminando bloqueo' }

  revalidatePath('/dashboard/whatsapp')
  revalidatePath('/dashboard/settings/clinic')
  return { ok: true }
}
