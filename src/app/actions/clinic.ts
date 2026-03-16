'use server'

// ============================================================
// Server Actions — Configuración general de la clínica
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, checkReadPermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import type { NotificationSettings } from '@/types/database'

// --- Tipos ---

export interface ClinicSettingsData {
  name: string
  phone: string
  contact_email: string
  website: string
  specialty: string[]
  consultation_price: number | null
  daily_goal_appointments: number
  address: string
  city: string
  department: string
  building: string
  floor: string
  office: string
  logo_url: string
}

// --- Acciones ---

/** Obtener datos completos de la clínica para el formulario */
export async function getClinicSettings(): Promise<ClinicSettingsData | null> {
  try {
    const clinicId = await checkReadPermission('settings')

    const { data } = await supabaseAdmin
      .from('clinics')
      .select(`
        name, phone, contact_email, website, specialty,
        consultation_price, daily_goal_appointments,
        address, city, department, building, floor, office, logo_url
      `)
      .eq('id', clinicId)
      .single()

    if (!data) return null

    return {
      name: data.name ?? '',
      phone: data.phone ?? '',
      contact_email: data.contact_email ?? '',
      website: data.website ?? '',
      specialty: data.specialty ?? [],
      consultation_price: data.consultation_price,
      daily_goal_appointments: data.daily_goal_appointments ?? 10,
      address: data.address ?? '',
      city: data.city ?? 'Pereira',
      department: data.department ?? 'Risaralda',
      building: data.building ?? '',
      floor: data.floor ?? '',
      office: data.office ?? '',
      logo_url: data.logo_url ?? '',
    }
  } catch {
    return null
  }
}

/** Guardar datos completos de la clínica */
export async function saveClinicSettings(
  input: ClinicSettingsData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('settings')

    if (!input.name.trim()) {
      return { ok: false, error: 'El nombre del consultorio es obligatorio' }
    }

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        name: input.name.trim(),
        phone: input.phone.trim(),
        contact_email: input.contact_email.trim() || null,
        website: input.website.trim() || null,
        specialty: input.specialty,
        consultation_price: input.consultation_price,
        daily_goal_appointments: input.daily_goal_appointments,
        address: input.address.trim() || null,
        city: input.city.trim() || 'Pereira',
        department: input.department.trim() || 'Risaralda',
        building: input.building.trim() || null,
        floor: input.floor.trim() || null,
        office: input.office.trim() || null,
        logo_url: input.logo_url.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando configuración' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'clinic_settings_updated',
      actor_type: 'staff',
      details: { name: input.name.trim() },
    })

    revalidatePath('/dashboard/settings')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Obtener config de notificaciones */
export async function getNotificationSettings(): Promise<NotificationSettings | null> {
  try {
    const clinicId = await checkReadPermission('settings')

    const { data } = await supabaseAdmin
      .from('clinics')
      .select('notification_settings')
      .eq('id', clinicId)
      .single()

    if (!data) return null

    const defaults: NotificationSettings = {
      reminder_24h: true,
      reminder_2h: false,
      morning_report: true,
      morning_report_hour: '06:00',
      noshow_alert: false,
      noshow_alert_threshold: 30,
      overdue_billing_alert: false,
      overdue_billing_days: 30,
    }

    return { ...defaults, ...(data.notification_settings as Partial<NotificationSettings>) }
  } catch {
    return null
  }
}

/** Guardar config de notificaciones */
export async function saveNotificationSettings(
  settings: NotificationSettings
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('settings')

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        notification_settings: settings as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando notificaciones' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'notification_settings_updated',
      actor_type: 'staff',
      details: settings as unknown as Record<string, unknown>,
    })

    revalidatePath('/dashboard/settings/notifications')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}
