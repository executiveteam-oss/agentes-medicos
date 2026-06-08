'use server'

// ============================================================
// Server actions del feature Resolución 256.
// Por ahora solo classifyRes256Category. UI eapb_codes en Fase 2.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission } from '@/lib/actions-helpers'
import type { Res256Category } from '@/types/database'

const VALID_CATEGORIES: Res256Category[] = ['Ginecología', 'Obstetricia', 'Ecografía', 'Resonancia Magnética', 'NoAplica']

export async function classifyRes256Category(
  consultationTypeId: string,
  category: Res256Category | null
): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await checkWritePermission('whatsapp')

  if (category !== null && !VALID_CATEGORIES.includes(category)) {
    return { ok: false, error: 'Categoría Res-256 inválida' }
  }

  const { error } = await supabaseAdmin
    .from('consultation_types')
    .update({ res256_category: category })
    .eq('id', consultationTypeId)
    .eq('clinic_id', clinicId)

  if (error) {
    console.error('[classifyRes256Category] Error:', error)
    return { ok: false, error: 'Error guardando categoría' }
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'consultation_type_res256_classified',
      actor_type: 'staff',
      target_type: 'consultation_type',
      target_id: consultationTypeId,
      details: { res256_category: category },
    })
  } catch { /* non-critical */ }

  return { ok: true }
}
