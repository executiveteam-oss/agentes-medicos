'use server'

// ============================================================
// Server Actions — Configuración del panel "Equipo"
// Bloque Coordinación: config de claim de conversaciones (Pieza A)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, extractActionError } from '@/lib/actions-helpers'
import type { ClaimConfig } from '@/lib/rules/claim-logic'
import { revalidatePath } from 'next/cache'

/**
 * Guarda la config de claim de conversaciones en clinics.feature_config.claim.
 *
 * MERGE, no clobber: feature_config ya tiene otras claves en producción
 * (media_reception_enabled del Bloque 4, config de retención de documentos,
 * etc). Sobrescribir el JSONB entero las apagaría en silencio. Por eso se
 * lee primero, se spread ...fc (preserva hermanos) y ...prevClaim (preserva
 * futuras sub-claves de claim que agregue Pieza B).
 */
export async function updateClaimConfig(config: ClaimConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    // Mismo gate que usan las demás actions del panel de usuarios
    // (src/app/actions/users.ts) — NO se inventa un módulo nuevo.
    const clinicId = await checkWritePermission('user_management')

    if (config.mode !== 'soft' && config.mode !== 'hard') {
      return { ok: false, error: 'Modo inválido' }
    }
    if (!Number.isFinite(config.expiryMinutes) || config.expiryMinutes <= 0) {
      return { ok: false, error: 'Vencimiento inválido' }
    }

    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('feature_config')
      .eq('id', clinicId)
      .single()

    const fc = ((clinic as { feature_config: Record<string, unknown> | null } | null)?.feature_config) ?? {}
    const prevClaim = (fc.claim && typeof fc.claim === 'object') ? (fc.claim as Record<string, unknown>) : {}
    const nextFc = {
      ...fc,
      claim: {
        ...prevClaim,
        enabled: config.enabled,
        mode: config.mode,
        expiry_minutes: config.expiryMinutes,
      },
    }

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({ feature_config: nextFc })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando la configuración' }

    revalidatePath('/dashboard/settings/users')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: extractActionError(err) }
  }
}
