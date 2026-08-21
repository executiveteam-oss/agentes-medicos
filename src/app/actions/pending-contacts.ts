'use server'

// ============================================================
// Server actions: Pending patient contacts
// Staff-facing list of patients who couldn't be reached via WhatsApp
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { getSessionClinicId } from '@/lib/actions-helpers'

export interface PendingContact {
  id: string
  clinic_id: string
  patient_id: string | null
  appointment_id: string | null
  // Espeja el CHECK de la tabla (migración 00109). Si divergen, el insert
  // pasa el typecheck y revienta en runtime contra la base.
  reason_type: 'reminder_failed' | 'cancellation_no_delivery' | 'waitlist_notification_failed' | 'reschedule_no_delivery'
  reason_text: string
  patient_name: string
  patient_phone: string
  doctor_name: string | null
  appointment_date: string | null
  consultation_type: string | null
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
export async function autoExpirePendingContacts(clinicId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const cid = await resolverClinica(clinicId)
  if (!cid) return 0   // sin clínica no se toca NADA (nunca "todas")

  const { data } = await supabaseAdmin
    .from('pending_contacts')
    .update({
      resolved_at: new Date().toISOString(),
      resolution_method: 'auto_expired',
    })
    .eq('clinic_id', cid)
    .is('resolved_at', null)
    .lt('appointment_date', cutoff)
    .select('id')

  return data?.length ?? 0
}

/** La clínica sobre la que opera una limpieza: la que se pasa, o la de la
 *  sesión. Si no hay ninguna devuelve null y el llamador NO toca nada — el
 *  default seguro de un proceso destructivo es cero filas, no todas. */
async function resolverClinica(clinicId?: string): Promise<string | null> {
  if (clinicId) return clinicId
  try { return await getSessionClinicId() } catch { return null }
}

/** Borra los contactos resueltos de MÁS de 7 días, de UNA clínica.
 *
 *  🔴 Antes no recibía clinicId y borraba sobre la tabla entera: llamado desde
 *  la sesión de una clínica, le limpiaba los contactos resueltos a todas las
 *  demás. Un borrado silencioso que cruzaba inquilinos. */
export async function cleanupOldPendingContacts(clinicId?: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const cid = await resolverClinica(clinicId)
  if (!cid) return 0   // sin clínica no se borra NADA (nunca "todas")

  const { data } = await supabaseAdmin
    .from('pending_contacts')
    .delete()
    .eq('clinic_id', cid)
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
  consultation_type?: string | null
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
      consultation_type: data.consultation_type ?? null,
    })

  // Silently ignore duplicate key violations (23505)
  if (error && !error.code?.startsWith('23505')) {
    console.error('[PendingContacts] Insert error:', error.message)
  }
}
