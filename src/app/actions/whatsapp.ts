'use server'

// ============================================================
// Server Actions — WhatsApp config + conversaciones activas
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import type { WhatsAppConfig } from '@/types/database'

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
  is_active: boolean
}

export interface WhatsAppPageData {
  activeConversations: ActiveConversation[]
  config: WhatsAppConfig
  doctors: DoctorForConfig[]
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

  const [convRes, clinicRes, doctorsRes] = await Promise.all([
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
      .select('whatsapp_config')
      .eq('id', clinicId)
      .single(),

    // Doctores de la clínica
    supabaseAdmin
      .from('doctors')
      .select('id, name, specialty, is_active')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: true }),
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

  const config: WhatsAppConfig = (clinicRes.data?.whatsapp_config as WhatsAppConfig) ?? DEFAULT_CONFIG

  return {
    activeConversations,
    config,
    doctors: (doctorsRes.data ?? []) as DoctorForConfig[],
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
