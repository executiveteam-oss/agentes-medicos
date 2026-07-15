// ============================================================
// Notificación in-app de escalación de conversaciones.
// buildEscalationPayload es puro (testeable sin DB). El resto
// (notifyStaffOfEscalation / resolveEscalationNotifications) toca
// DB y se agrega en la Task 3.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createStaffNotification } from './create-notification'

const MAX_BODY = 120

/** Trunca a MAX_BODY chars agregando "..." si se pasó. Puro. */
function truncate(s: string): string {
  const t = s.trim()
  return t.length > MAX_BODY ? t.slice(0, MAX_BODY) + '...' : t
}

/**
 * Construye el payload de una notif de escalación. Puro, sin DB.
 * NO incluye recipient — el fan-out lo hace notifyStaffOfEscalation.
 */
export function buildEscalationPayload(
  patientName: string | null,
  reason: string,
  conversationId: string,
): { type: 'conversation_escalated'; title: string; body: string; navigateTo: string } {
  const displayName = patientName?.trim() || 'Paciente nuevo'
  return {
    type: 'conversation_escalated',
    title: `${displayName} necesita atención`,
    body: truncate(reason),
    navigateTo: `/dashboard/conversations/${conversationId}`,
  }
}

/**
 * Inserta una notif de escalación para todo el staff no-Doctor de la
 * clínica. IDEMPOTENTE: si ya hay una escalación NO resuelta para esa
 * conversación, no hace nada (una sola alerta viva por conversación).
 * Nunca lanza — fire-and-forget seguro para el webhook.
 */
export async function notifyStaffOfEscalation(params: {
  clinicId: string
  conversationId: string
  patientName: string | null
  reason: string
}): Promise<void> {
  const { clinicId, conversationId, patientName, reason } = params
  try {
    // Idempotencia: ¿ya hay una alerta viva para esta conversación?
    const { data: existing } = await supabaseAdmin
      .from('staff_notifications')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('type', 'conversation_escalated')
      .is('read_at', null)
      .limit(1)
      .maybeSingle()

    if (existing) return // alerta viva → no multiplicar filas

    const payload = buildEscalationPayload(patientName, reason, conversationId)
    await createStaffNotification(
      clinicId,
      { type: payload.type, title: payload.title, body: payload.body, metadata: { patient_name: patientName ?? null }, navigateTo: payload.navigateTo },
      conversationId,
    )
  } catch (err) {
    console.error('[Escalation] notifyStaffOfEscalation falló (no crítico):', err)
  }
}

/**
 * Resuelve (marca read_at) TODAS las notifs de escalación no resueltas de
 * una conversación — clinic-wide, de una query. Se llama cuando alguien
 * atiende (reabrir / resolver / responder). Idempotente. Nunca lanza.
 */
export async function resolveEscalationNotifications(conversationId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('staff_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('type', 'conversation_escalated')
      .is('read_at', null)
  } catch (err) {
    console.error('[Escalation] resolveEscalationNotifications falló (no crítico):', err)
  }
}
