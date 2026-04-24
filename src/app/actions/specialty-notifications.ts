'use server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'

export interface SpecialtyNotification {
  id: string
  specialty_name: string
  notification_phone: string
  contact_name: string | null
}

export async function getSpecialtyNotifications(): Promise<SpecialtyNotification[]> {
  const clinicId = await checkReadPermission('settings')
  const { data } = await supabaseAdmin
    .from('specialty_notifications')
    .select('id, specialty_name, notification_phone, contact_name')
    .eq('clinic_id', clinicId)
    .order('specialty_name')
  return (data ?? []) as SpecialtyNotification[]
}

export async function saveSpecialtyNotification(input: {
  specialtyName: string
  notificationPhone: string
  contactName?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await checkWritePermission('settings')
  if (!input.specialtyName.trim() || !input.notificationPhone.trim()) {
    return { ok: false, error: 'Especialidad y teléfono son obligatorios' }
  }

  const { error } = await supabaseAdmin
    .from('specialty_notifications')
    .upsert({
      clinic_id: clinicId,
      specialty_name: input.specialtyName.trim(),
      notification_phone: input.notificationPhone.trim(),
      contact_name: input.contactName?.trim() || null,
    }, { onConflict: 'clinic_id,specialty_name' })

  if (error) return { ok: false, error: 'Error guardando' }
  revalidatePath('/dashboard/settings/clinic')
  return { ok: true }
}

export async function deleteSpecialtyNotification(id: string): Promise<{ ok: boolean }> {
  const clinicId = await checkWritePermission('settings')
  await supabaseAdmin.from('specialty_notifications').delete().eq('id', id).eq('clinic_id', clinicId)
  revalidatePath('/dashboard/settings/clinic')
  return { ok: true }
}

/** Get the notification phone for a specialty, fallback to escalation_contact_phone */
export async function getNotificationPhoneForSpecialty(clinicId: string, specialty: string | null): Promise<string | null> {
  if (specialty) {
    const { data } = await supabaseAdmin
      .from('specialty_notifications')
      .select('notification_phone')
      .eq('clinic_id', clinicId)
      .eq('specialty_name', specialty)
      .maybeSingle()
    if (data?.notification_phone) return data.notification_phone
  }
  // Fallback to clinic's escalation_contact_phone
  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('escalation_contact_phone')
    .eq('id', clinicId)
    .single()
  return (clinic as Record<string, unknown>)?.escalation_contact_phone as string | null ?? null
}
