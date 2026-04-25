'use server'

// ============================================================
// Server Actions — Feature config (Mi Plan)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission } from '@/lib/actions-helpers'
import type { FeatureConfig } from '@/types/database'

const DEFAULT_FEATURES: FeatureConfig = {
  agent: true,
  reminders_24h: true,
  reminders_72h: true,
  docs_required: true,
  waitlist: true,
  reactivation: true,
  dashboard: true,
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
  clinicName: string
}

/** Obtener configuración de features y plan */
export async function getPlanData(): Promise<PlanData | null> {
  try {
    const clinicId = await checkReadPermission('settings')

    const { data } = await supabaseAdmin
      .from('clinics')
      .select('name, feature_config, preferred_plan, subscription_plan, subscription_status, expected_doctors, expected_monthly_appointments')
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
      clinicName: data.name ?? 'Mi consultorio',
    }
  } catch {
    return null
  }
}

/**
 * Actualizar una feature individual.
 * DESHABILITADO desde la UI — módulos Plus solo se activan manualmente
 * por el equipo de Omuwan vía Supabase dashboard.
 * TODO: habilitar cuando se construya panel admin interno.
 */
export async function toggleFeature(
  _featureKey: keyof FeatureConfig,
  _enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'Para activar módulos Plus, contacta a soporte por WhatsApp.' }
}
