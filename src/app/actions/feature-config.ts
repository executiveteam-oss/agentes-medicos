'use server'

// ============================================================
// Server Actions — Feature config (Mi Plan)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, checkReadPermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import type { FeatureConfig } from '@/types/database'

const DEFAULT_FEATURES: FeatureConfig = {
  agent: true,
  reminders_24h: true,
  reminders_72h: true,
  docs_required: true,
  waitlist: true,
  reactivation: true,
  dashboard: true,
  insights: true,
  virtual: true,
  vacations: true,
  ai_assistant: true,
  cartera: true,
  facturacion: true,
  estadisticas: true,
}

export interface PlanData {
  featureConfig: FeatureConfig
  preferredPlan: string | null
  subscriptionPlan: string
  subscriptionStatus: string
  expectedDoctors: number | null
  expectedMonthlyAppointments: number | null
}

/** Obtener configuración de features y plan */
export async function getPlanData(): Promise<PlanData | null> {
  try {
    const clinicId = await checkReadPermission('settings')

    const { data } = await supabaseAdmin
      .from('clinics')
      .select('feature_config, preferred_plan, subscription_plan, subscription_status, expected_doctors, expected_monthly_appointments')
      .eq('id', clinicId)
      .single()

    if (!data) return null

    return {
      featureConfig: { ...DEFAULT_FEATURES, ...((data.feature_config as Partial<FeatureConfig>) ?? {}) },
      preferredPlan: data.preferred_plan ?? null,
      subscriptionPlan: data.subscription_plan ?? 'basic',
      subscriptionStatus: data.subscription_status ?? 'trial',
      expectedDoctors: data.expected_doctors ?? null,
      expectedMonthlyAppointments: data.expected_monthly_appointments ?? null,
    }
  } catch {
    return null
  }
}

/** Actualizar una feature individual */
export async function toggleFeature(
  featureKey: keyof FeatureConfig,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('settings')

    // No permitir desactivar features base
    if (['agent', 'reminders_24h', 'dashboard'].includes(featureKey) && !enabled) {
      return { ok: false, error: 'Esta función no se puede desactivar' }
    }

    // Leer config actual
    const { data: current } = await supabaseAdmin
      .from('clinics')
      .select('feature_config')
      .eq('id', clinicId)
      .single()

    const config: FeatureConfig = { ...DEFAULT_FEATURES, ...((current?.feature_config as Partial<FeatureConfig>) ?? {}) }
    config[featureKey] = enabled

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        feature_config: config as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando configuración' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'feature_config_updated',
      actor_type: 'staff',
      details: { feature: featureKey, enabled },
    })

    revalidatePath('/dashboard/settings/plan')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}
