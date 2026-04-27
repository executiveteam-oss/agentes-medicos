'use server'

// ============================================================
// Server Actions — Configuración general de la clínica
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, checkReadPermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import type { NotificationSettings, VirtualConsultationConfig } from '@/types/database'

// --- Tipos ---

const DEFAULT_VIRTUAL_CONFIG: VirtualConsultationConfig = {
  enabled: false,
  platform: 'custom',
  base_url: null,
  instructions: null,
}

export interface ClinicSettingsData {
  name: string
  agent_name: string
  phone: string
  contact_email: string
  website: string
  specialty: string[]
  consultation_price: number | null
  min_booking_advance_hours: number
  max_booking_advance_days: number
  address: string
  city: string
  department: string
  building: string
  floor: string
  office: string
  logo_url: string
  virtual_config: VirtualConsultationConfig
  escalation_contact_phone: string
  cancellation_policy: string
  welcome_message: string
  clinic_info: string
}

// --- Acciones ---

/** Obtener datos completos de la clínica para el formulario */
export async function getClinicSettings(): Promise<ClinicSettingsData | null> {
  try {
    const clinicId = await checkReadPermission('settings')

    const { data } = await supabaseAdmin
      .from('clinics')
      .select(`
        name, agent_name, phone, contact_email, website, specialty,
        consultation_price,
        min_booking_advance_hours, max_booking_advance_days,
        address, city, department, building, floor, office, logo_url,
        virtual_config, escalation_contact_phone, cancellation_policy, welcome_message, clinic_info
      `)
      .eq('id', clinicId)
      .single()

    if (!data) return null

    return {
      name: data.name ?? '',
      agent_name: data.agent_name ?? '',
      phone: data.phone ?? '',
      contact_email: data.contact_email ?? '',
      website: data.website ?? '',
      specialty: data.specialty ?? [],
      consultation_price: data.consultation_price,
      min_booking_advance_hours: data.min_booking_advance_hours ?? 24,
      max_booking_advance_days: data.max_booking_advance_days ?? 60,
      address: data.address ?? '',
      city: data.city ?? 'Pereira',
      department: data.department ?? 'Risaralda',
      building: data.building ?? '',
      floor: data.floor ?? '',
      office: data.office ?? '',
      logo_url: data.logo_url ?? '',
      virtual_config: { ...DEFAULT_VIRTUAL_CONFIG, ...((data.virtual_config as Partial<VirtualConsultationConfig>) ?? {}) },
      escalation_contact_phone: (data as Record<string, unknown>).escalation_contact_phone as string ?? '',
      cancellation_policy: (data as Record<string, unknown>).cancellation_policy as string ?? '',
      welcome_message: (data as Record<string, unknown>).welcome_message as string ?? '',
      clinic_info: (data as Record<string, unknown>).clinic_info as string ?? '',
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

    // Asegurar que specialty sea un array (puede llegar undefined si el campo no se tocó)
    const specialty = Array.isArray(input.specialty) ? input.specialty : []

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        name: input.name.trim(),
        agent_name: input.agent_name.trim() || 'Asistente',
        phone: input.phone.trim(),
        contact_email: input.contact_email.trim() || null,
        website: input.website.trim() || null,
        specialty,
        consultation_price: input.consultation_price,
        min_booking_advance_hours: input.min_booking_advance_hours,
        max_booking_advance_days: input.max_booking_advance_days,
        address: input.address.trim() || null,
        city: input.city.trim() || 'Pereira',
        department: input.department.trim() || 'Risaralda',
        building: input.building.trim() || null,
        floor: input.floor.trim() || null,
        office: input.office.trim() || null,
        logo_url: input.logo_url.trim() || null,
        virtual_config: input.virtual_config as unknown as Record<string, unknown>,
        escalation_contact_phone: input.escalation_contact_phone.trim() || null,
        cancellation_policy: input.cancellation_policy.trim() || null,
        welcome_message: input.welcome_message.trim() || null,
        clinic_info: input.clinic_info.trim() || null,
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
    revalidatePath('/dashboard/settings/clinic')
    revalidatePath('/dashboard/whatsapp')
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
      reminder_72h: false,
      reminder_24h: true,
      reminder_2h: false,
      morning_report: true,
      morning_report_hour: '06:00',
      weekly_report: true,
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
