'use server'

// ============================================================
// Server Actions — WhatsApp config + conversaciones activas
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import type { WhatsAppConfig, WorkingHours } from '@/types/database'

// --- Tipos ---

export interface ActiveConversation {
  id: string
  patient_name: string
  patient_phone: string
  last_message: string
  last_message_at: string
  message_count: number
}

export interface DoctorForConfig {
  id: string
  name: string
  specialty: string | null
  phone: string | null
  is_active: boolean
  agenda_closed: boolean
  agenda_closed_reason: string | null
  agenda_closed_until: string | null
  schedule_type: 'fixed' | 'manual'
  manual_availability_message: string | null
  working_hours: WorkingHours | null
}

export interface WhatsAppPageData {
  activeConversations: ActiveConversation[]
  config: WhatsAppConfig
  doctors: DoctorForConfig[]
  whatsappConnected: boolean
  whatsappPhoneDisplay: string | null
  hasIsalud: boolean
}

const DEFAULT_CONFIG: WhatsAppConfig = {
  schedule: {
    start: '07:00',
    end: '20:00',
    days: [1, 2, 3, 4, 5, 6],
    out_of_hours_message: 'Hola, nuestro horario de atención es de 7am a 8pm. Te responderemos mañana.',
  },
  appointment: {
    default_duration: 30,
    max_duration: 60,
  },
  escalation_keywords: ['urgencia', 'dolor', 'emergencia', 'hablar con alguien', 'médico', 'sangrado'],
  doctors: {},
  automations: {
    post_consulta: { enabled: false },
    reactivacion: { enabled: false, days_inactive: 90 },
  },
}

/**
 * Obtener datos para la página de WhatsApp:
 * conversaciones activas de hoy + config + doctores
 */
export async function getWhatsAppPageData(): Promise<WhatsAppPageData> {
  const clinicId = await checkReadPermission('whatsapp')

  // Inicio del día en hora Colombia (UTC-5)
  const now = new Date()
  const colombiaOffset = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const todayStart = new Date(colombiaOffset.getFullYear(), colombiaOffset.getMonth(), colombiaOffset.getDate())
  const todayStartUTC = new Date(todayStart.getTime() + 5 * 60 * 60 * 1000)

  const [convRes, clinicRes, doctorsRes, isaludRes] = await Promise.all([
    // Conversaciones activas con último mensaje hoy
    supabaseAdmin
      .from('conversations')
      .select('id, patient_id, status, last_message_at, patients(name, phone)')
      .eq('clinic_id', clinicId)
      .eq('status', 'active')
      .gte('last_message_at', todayStartUTC.toISOString())
      .order('last_message_at', { ascending: false }),

    // Config de la clínica
    supabaseAdmin
      .from('clinics')
      .select('whatsapp_config, whatsapp_phone_id, whatsapp_connected, whatsapp_phone_display')
      .eq('id', clinicId)
      .single(),

    // Doctores de la clínica
    supabaseAdmin
      .from('doctors')
      .select('id, name, specialty, phone, is_active, agenda_closed, agenda_closed_reason, agenda_closed_until, schedule_type, manual_availability_message, working_hours')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: true }),

    // ¿La clínica tiene iSalud conectado? (controla visibilidad del botón "Importar desde iSalud")
    supabaseAdmin
      .from('sync_integrations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud'),
  ])

  // Obtener último mensaje y conteo por conversación
  const convIds = (convRes.data ?? []).map((c) => c.id)
  let lastMessages: Record<string, { content: string; count: number }> = {}

  if (convIds.length > 0) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('conversation_id, content, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })

    for (const m of msgs ?? []) {
      if (!lastMessages[m.conversation_id]) {
        lastMessages[m.conversation_id] = { content: m.content, count: 0 }
      }
      lastMessages[m.conversation_id].count++
    }
  }

  const activeConversations: ActiveConversation[] = (convRes.data ?? []).map((c) => {
    const patient = c.patients as unknown as { name: string; phone: string } | null
    const msgInfo = lastMessages[c.id]
    return {
      id: c.id,
      patient_name: patient?.name ?? 'Desconocido',
      patient_phone: patient?.phone ?? '',
      last_message: msgInfo?.content ?? '',
      last_message_at: c.last_message_at,
      message_count: msgInfo?.count ?? 0,
    }
  })

  const rawConfig = (clinicRes.data?.whatsapp_config as WhatsAppConfig) ?? DEFAULT_CONFIG
  // Merge defaults para campos nuevos (automations) en clínicas existentes
  const config: WhatsAppConfig = {
    ...DEFAULT_CONFIG,
    ...rawConfig,
    automations: {
      ...DEFAULT_CONFIG.automations,
      ...(rawConfig.automations ?? {}),
      post_consulta: { ...DEFAULT_CONFIG.automations.post_consulta, ...(rawConfig.automations?.post_consulta ?? {}) },
      reactivacion: { ...DEFAULT_CONFIG.automations.reactivacion, ...(rawConfig.automations?.reactivacion ?? {}) },
    },
  }

  return {
    activeConversations,
    config,
    doctors: (doctorsRes.data ?? []) as DoctorForConfig[],
    whatsappConnected: !!(clinicRes.data?.whatsapp_phone_id && clinicRes.data?.whatsapp_connected),
    whatsappPhoneDisplay: (clinicRes.data as Record<string, unknown>)?.whatsapp_phone_display as string | null ?? null,
    hasIsalud: (isaludRes.count ?? 0) > 0,
  }
}

/**
 * Guardar configuración de WhatsApp
 */
export async function saveWhatsAppConfig(config: WhatsAppConfig): Promise<{ success: boolean; error?: string }> {
  const clinicId = await checkWritePermission('whatsapp')

  const { error } = await supabaseAdmin
    .from('clinics')
    .update({ whatsapp_config: config as unknown as Record<string, unknown> })
    .eq('id', clinicId)

  if (error) {
    console.error('[saveWhatsAppConfig] Error:', error)
    return { success: false, error: 'Error guardando configuración' }
  }

  return { success: true }
}
