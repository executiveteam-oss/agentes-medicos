'use server'

// Pieza A — Claim de conversaciones. Gate conversations.write. Filtra por clinic_id.
// Vencimiento se computa al leer (parseClaimConfig + resolveClaimState). Sin cron.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, extractActionError } from '@/lib/actions-helpers'
import { getUserSession } from '@/lib/session'
import { parseClaimConfig, resolveClaimState } from '@/lib/rules/claim-logic'
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

  const { state } = resolveClaimState(conv, session.clinicUserId, config.expiryMinutes, Date.now())
  if (state === 'others') {
    return { ok: true, enabled: true, state, byName: conv.claimed_by_name }
  }
  // free | mine → tomar / refrescar
  await supabaseAdmin
    .from('conversations')
    .update({ claimed_by: session.clinicUserId, claimed_by_name: session.fullName, claimed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
  return { ok: true, enabled: true, state: 'mine' as const, byName: session.fullName }
}

/** Soltar la propia (o cualquiera; idempotente). */
export async function releaseConversation(conversationId: string) {
  let clinicId: string
  try { clinicId = await checkWritePermission('conversations') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

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

  const conv = await loadConv(conversationId, clinicId)
  if (!conv) return { ok: false, error: 'Conversación no encontrada' }

  const heldMinutes = conv.claimed_at ? Math.floor((Date.now() - Date.parse(conv.claimed_at)) / 60_000) : null

  await supabaseAdmin
    .from('conversations')
    .update({ claimed_by: session.clinicUserId, claimed_by_name: session.fullName, claimed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)

  // Invariante: el override SIEMPRE se audita (la otra mitad de sender_name).
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'conversation_claim_override',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation',
    target_id: conversationId,
    details: { from_user_id: conv.claimed_by, from_user_name: conv.claimed_by_name, minutes_held: heldMinutes },
  })

  revalidatePath('/dashboard/conversations')
  return { ok: true }
}
