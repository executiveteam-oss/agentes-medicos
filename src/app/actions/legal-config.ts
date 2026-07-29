'use server'

// ============================================================
// Config legal por clínica — URL de la política de privacidad.
// Gate: settings.write (Admin). Es un dato legal sensible.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, extractActionError } from '@/lib/actions-helpers'

/** Setea (o limpia con '') la URL de la política de privacidad de la clínica. */
export async function updatePrivacyPolicyUrl(
  rawUrl: string,
): Promise<{ ok: boolean; error?: string; url?: string | null }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('settings') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const url = rawUrl.trim()
  // Vacío = limpiar (vuelve al comportamiento sin link). Si hay valor, validar
  // que sea una URL https — un link roto sería peor que no tener nada.
  if (url.length > 0) {
    let parsed: URL
    try { parsed = new URL(url) }
    catch { return { ok: false, error: 'La URL no es válida. Debe empezar con https://' } }
    if (parsed.protocol !== 'https:') return { ok: false, error: 'La URL debe usar https://' }
  }

  const { error } = await supabaseAdmin
    .from('clinics')
    .update({ privacy_policy_url: url.length > 0 ? url : null })
    .eq('id', clinicId)
  if (error) return { ok: false, error: 'Error guardando la URL' }

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId, action: 'privacy_policy_url_updated', actor_type: 'staff',
    details: { url: url.length > 0 ? url : null },
  })

  return { ok: true, url: url.length > 0 ? url : null }
}
