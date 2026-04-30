'use server'

// ============================================================
// Server actions: Pending patient contacts
// Staff-facing list of patients who couldn't be reached via WhatsApp
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'

export interface PendingContact {
  id: string
  clinic_id: string
  patient_id: string | null
  appointment_id: string | null
  reason_type: 'reminder_failed' | 'cancellation_no_delivery' | 'waitlist_notification_failed'
  reason_text: string
  patient_name: string
  patient_phone: string
  doctor_name: string | null
  appointment_date: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_method: string | null
  created_at: string
}

/** Get pending contacts (unresolved) + recent history (resolved in last 7 days) */
export async function getPendingContacts(): Promise<{
  pending: PendingContact[]
  history: PendingContact[]
}> {
  const session = await getUserSession()
  if (!session) return { pending: [], history: [] }

  const clinicId = session.clinicId
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [pendingResult, historyResult] = await Promise.all([
    supabaseAdmin
      .from('pending_contacts')
      .select('*')
      .eq('clinic_id', clinicId)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('pending_contacts')
      .select('*')
      .eq('clinic_id', clinicId)
      .not('resolved_at', 'is', null)
      .gte('created_at', sevenDaysAgo)
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  return {
    pending: (pendingResult.data ?? []) as PendingContact[],
    history: (historyResult.data ?? []) as PendingContact[],
  }
}

/** Mark a pending contact as resolved by staff */
export async function markPendingContactResolved(contactId: string): Promise<{ ok: boolean }> {
  const session = await getUserSession()
  if (!session) return { ok: false }

  const { error } = await supabaseAdmin
    .from('pending_contacts')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: session.authUserId,
      resolution_method: 'manual_whatsapp',
    })
    .eq('id', contactId)
    .eq('clinic_id', session.clinicId)

  return { ok: !error }
}

/** Auto-expire pending contacts for appointments >48h ago */
export async function autoExpirePendingContacts(): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data } = await supabaseAdmin
    .from('pending_contacts')
    .update({
      resolved_at: new Date().toISOString(),
      resolution_method: 'auto_expired',
    })
    .is('resolved_at', null)
    .lt('appointment_date', cutoff)
    .select('id')

  return data?.length ?? 0
}

/** Delete resolved contacts older than 7 days (hard cleanup) */
export async function cleanupOldPendingContacts(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabaseAdmin
    .from('pending_contacts')
    .delete()
    .not('resolved_at', 'is', null)
    .lt('resolved_at', sevenDaysAgo)
    .select('id')

  return data?.length ?? 0
}

/**
 * Insert a pending contact (used by crons and cancel-notify).
 * Silently ignores duplicates — the partial UNIQUE index on
 * (clinic_id, appointment_id, reason_type) WHERE resolved_at IS NULL
 * prevents duplicates at DB level.
 */
export async function insertPendingContact(data: {
  clinic_id: string
  patient_id?: string | null
  appointment_id: string
  reason_type: PendingContact['reason_type']
  reason_text: string
  patient_name: string
  patient_phone: string
  doctor_name?: string | null
  appointment_date?: string | null
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('pending_contacts')
    .insert({
      clinic_id: data.clinic_id,
      patient_id: data.patient_id ?? null,
      appointment_id: data.appointment_id,
      reason_type: data.reason_type,
      reason_text: data.reason_text,
      patient_name: data.patient_name,
      patient_phone: data.patient_phone,
      doctor_name: data.doctor_name ?? null,
      appointment_date: data.appointment_date ?? null,
    })

  // Silently ignore duplicate key violations (23505)
  if (error && !error.code?.startsWith('23505')) {
    console.error('[PendingContacts] Insert error:', error.message)
  }
}
