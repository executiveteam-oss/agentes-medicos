// ============================================================
// Feature Gate — utilidades para verificar features por clínica
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { FeatureConfig } from '@/types/database'

/** Mapa de features → rutas o identificadores internos */
export const FEATURE_MAP: Record<string, string> = {
  virtual: '/dashboard/settings/virtual',
  reactivation: 'reactivation_cron',
  waitlist: '/dashboard/espera',
  docs_required: 'docs_feature',
  dashboard: '/dashboard',
  reminders_24h: 'reminders_cron',
  agent: 'whatsapp_agent',
}

const ALL_ENABLED: FeatureConfig = {
  agent: true,
  reminders_24h: true,
  reminders_72h: true,
  docs_required: true,
  waitlist: true,
  reactivation: true,
  dashboard: true,
  virtual: true,
  vacations: true,
}

export interface FeatureGateResult {
  config: FeatureConfig
  expectedDoctors: number | null
}

/** Obtiene feature_config y expected_doctors de la clínica. Si es null, retorna todo habilitado. */
export async function getFeatureConfig(clinicId: string): Promise<FeatureConfig> {
  const result = await getFeatureGate(clinicId)
  return result.config
}

/** Obtiene feature_config + expected_doctors para mostrar precios Plus correctos */
export async function getFeatureGate(clinicId: string): Promise<FeatureGateResult> {
  const { data } = await supabaseAdmin
    .from('clinics')
    .select('feature_config, expected_doctors')
    .eq('id', clinicId)
    .single()

  const config = data?.feature_config
    ? { ...ALL_ENABLED, ...(data.feature_config as Partial<FeatureConfig>) }
    : { ...ALL_ENABLED }

  return {
    config,
    expectedDoctors: (data?.expected_doctors as number | null) ?? null,
  }
}

/** Verifica si una feature está habilitada */
export function isFeatureEnabled(
  featureConfig: FeatureConfig | null,
  feature: keyof FeatureConfig
): boolean {
  if (!featureConfig) return true
  return featureConfig[feature] !== false
}
