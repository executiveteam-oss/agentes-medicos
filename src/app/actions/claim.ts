'use server'

// Pieza A — Claim de conversaciones. Gate conversations.write. Filtra por clinic_id.
// Vencimiento se computa vía update atómico condicional (.or() con threshold). Sin cron.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, extractActionError } from '@/lib/actions-helpers'
import { getUserSession } from '@/lib/session'
import { parseClaimConfig } from '@/lib/rules/claim-logic'
import { revalidatePath } from 'next/cache'

interface ConvClaimRow {
  clinic_id: string
  claimed_by: string | null
  claimed_by_name: string | null
  claimed_at: string | null
}

async function loadConv(conversationId: string, clinicId: string): Promise<ConvClaimRow | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('clinic_id, claimed_by, claimed_by_name, claimed_at')
    .eq('id', conversationId)
    .maybeSingle()
  const row = data as ConvClaimRow | null
  if (!row || row.clinic_id !== clinicId) return null
  return row
}

async function loadClaimConfig(clinicId: string) {
  const { data } = await supabaseAdmin.from('clinics').select('feature_config').eq('id', clinicId).single()
  return parseClaimConfig((data as { feature_config: unknown } | null)?.feature_config)
}

/** Auto-claim al abrir. Toma si está libre/vencida/propia; si es de otra vigente, NO toma. */
export async function claimConversation(conversationId: string) {
  let clinicId: string
  try { clinicId = await checkWritePermission('conversations') }
  catch (err) { return { ok: false, error: extractActionError(err) } }
  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const config = await loadClaimConfig(clinicId)
  if (!config.enabled) return { ok: true, enabled: false, state: 'free' as const }

  const conv = await loadConv(conversationId, clinicId)
  if (!conv) return { ok: false, error: 'Conversación no encontrada' }

  // Update atómico condicional: solo escribe si la fila sigue siendo reclamable
  // (libre, propia, o vencida). Evita TOCTOU: dos usuarios leyendo 'free' a la vez
  // y ambos escribiendo — acá solo uno gana la condición del .or().
  const expiryThresholdIso = new Date(Date.now() - config.expiryMinutes * 60_000).toISOString()
  const { data: claimed, error: upErr } = await supabaseAdmin
    .from('conversations')
    .update({ claimed_by: session.clinicUserId, claimed_by_name: session.fullName, claimed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
    .or(`claimed_by.is.null,claimed_by.eq.${session.clinicUserId},claimed_at.lt.${expiryThresholdIso}`)
    .select('id')
  if (upErr) return { ok: false, error: 'Error tomando la conversación' }
  if (claimed && claimed.length > 0) return { ok: true, enabled: true, state: 'mine' as const, byName: session.fullName }

  // 0 filas afectadas → otra persona la tiene vigente. Releer para devolver su nombre.
  const fresh = await loadConv(conversationId, clinicId)
  return { ok: true, enabled: true, state: 'others' as const, byName: fresh?.claimed_by_name ?? null }
}

/** Soltar la propia (o cualquiera; idempotente). */
export async function releaseConversation(conversationId: string) {
  let clinicId: string
  try { clinicId = await checkWritePermission('conversations') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const config = await loadClaimConfig(clinicId)
  if (!config.enabled) return { ok: true }

  const { error } = await supabaseAdmin
    .from('conversations')
    .update({ claimed_by: null, claimed_by_name: null, claimed_at: null })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
  if (error) return { ok: false, error: 'Error liberando la conversación' }
  revalidatePath('/dashboard/conversations')
  return { ok: true }
}

/** "Tomar de todos modos" (escape del modo duro). Transfiere + AUDITA quién sacó a quién. */
export async function overrideClaim(conversationId: string) {
  let clinicId: string
  try { clinicId = await checkWritePermission('conversations') }
  catch (err) { return { ok: false, error: extractActionError(err) } }
  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const config = await loadClaimConfig(clinicId)
  if (!config.enabled) return { ok: true }

  const conv = await loadConv(conversationId, clinicId)
  if (!conv) return { ok: false, error: 'Conversación no encontrada' }

  const heldMinutes = conv.claimed_at ? Math.floor((Date.now() - Date.parse(conv.claimed_at)) / 60_000) : null

  // Invariante: el override SIEMPRE se audita. Se escribe la auditoría PRIMERO
  // y se verifica su resultado — si falla, NO se transfiere el claim. Así nunca
  // queda una transferencia sin rastro de quién sacó a quién.
  const { error: auditErr } = await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'conversation_claim_override',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation',
    target_id: conversationId,
    details: { from_user_id: conv.claimed_by, from_user_name: conv.claimed_by_name, minutes_held: heldMinutes },
  })
  if (auditErr) return { ok: false, error: 'No se pudo registrar el override' }

  const { error: updateErr } = await supabaseAdmin
    .from('conversations')
    .update({ claimed_by: session.clinicUserId, claimed_by_name: session.fullName, claimed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
  if (updateErr) return { ok: false, error: 'Error tomando la conversación' }

  revalidatePath('/dashboard/conversations')
  return { ok: true }
}
