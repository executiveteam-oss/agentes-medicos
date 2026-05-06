'use server'

// ============================================================
// Server Actions — Agent config (partial updates)
// Updates personality, keywords, and automations without
// touching other whatsapp_config fields.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import type { WhatsAppConfig } from '@/types/database'

const VALID_PERSONALITIES = ['formal', 'profesional y amable', 'directo'] as const

/** Update clinics.agent_personality */
export async function updateAgentPersonality(
  personality: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    if (!VALID_PERSONALITIES.includes(personality as typeof VALID_PERSONALITIES[number])) {
      return { success: false, error: 'Valor de personalidad no valido' }
    }

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({ agent_personality: personality })
      .eq('id', clinicId)

    if (error) return { success: false, error: 'Error guardando personalidad' }

    revalidatePath('/dashboard/tu-agente')
    return { success: true }
  } catch {
    return { success: false, error: 'Error de permisos o sesión' }
  }
}

/** Update whatsapp_config.escalation_keywords (preserves rest of JSONB) */
export async function updateEscalationKeywords(
  keywords: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    // Validate
    if (keywords.length > 30) return { success: false, error: 'Maximo 30 keywords' }
    const cleaned = keywords
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0 && k.length <= 50)

    // Load current config
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_config')
      .eq('id', clinicId)
      .single()

    const currentConfig = (clinic?.whatsapp_config ?? {}) as WhatsAppConfig

    // Merge — only update escalation_keywords
    const updatedConfig = {
      ...currentConfig,
      escalation_keywords: cleaned,
    }

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({ whatsapp_config: updatedConfig as unknown as Record<string, unknown> })
      .eq('id', clinicId)

    if (error) return { success: false, error: 'Error guardando keywords' }

    revalidatePath('/dashboard/tu-agente')
    return { success: true }
  } catch {
    return { success: false, error: 'Error de permisos o sesión' }
  }
}

/** Update whatsapp_config.automations (preserves rest of JSONB) */
export async function updateAutomations(
  automations: { post_consulta: boolean; reactivacion: boolean }
): Promise<{ success: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    // Load current config
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_config')
      .eq('id', clinicId)
      .single()

    const currentConfig = (clinic?.whatsapp_config ?? {}) as WhatsAppConfig
    const currentAutomations = currentConfig.automations ?? {
      post_consulta: { enabled: false },
      reactivacion: { enabled: false, days_inactive: 90 },
    }

    // Merge — only update enabled flags, preserve days_inactive
    const updatedConfig: WhatsAppConfig = {
      ...currentConfig,
      automations: {
        post_consulta: { enabled: automations.post_consulta },
        reactivacion: {
          ...currentAutomations.reactivacion,
          enabled: automations.reactivacion,
        },
      },
    }

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({ whatsapp_config: updatedConfig as unknown as Record<string, unknown> })
      .eq('id', clinicId)

    if (error) return { success: false, error: 'Error guardando automatizaciones' }

    revalidatePath('/dashboard/tu-agente')
    return { success: true }
  } catch {
    return { success: false, error: 'Error de permisos o sesión' }
  }
}
