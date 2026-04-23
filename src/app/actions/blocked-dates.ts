'use server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'

export interface BlockedDate {
  id: string
  clinic_id: string
  doctor_id: string | null
  start_date: string
  end_date: string
  reason: string | null
  created_at: string
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

export async function createBlockedDate(input: {
  doctorId?: string | null
  startDate: string
  endDate: string
  reason?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await checkWritePermission('whatsapp')
  if (!input.startDate || !input.endDate) return { ok: false, error: 'Fechas obligatorias' }
  if (input.endDate < input.startDate) return { ok: false, error: 'La fecha fin debe ser igual o posterior a la fecha inicio' }

  const { error } = await supabaseAdmin.from('blocked_dates').insert({
    clinic_id: clinicId,
    doctor_id: input.doctorId || null,
    start_date: input.startDate,
    end_date: input.endDate,
    reason: input.reason?.trim() || null,
  })
  if (error) return { ok: false, error: 'Error creando bloqueo' }

  revalidatePath('/dashboard/whatsapp')
  revalidatePath('/dashboard/settings/clinic')
  return { ok: true }
}

export async function deleteBlockedDate(id: string): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await checkWritePermission('whatsapp')
  const { error } = await supabaseAdmin.from('blocked_dates').delete().eq('id', id).eq('clinic_id', clinicId)
  if (error) return { ok: false, error: 'Error eliminando bloqueo' }

  revalidatePath('/dashboard/whatsapp')
  revalidatePath('/dashboard/settings/clinic')
  return { ok: true }
}
