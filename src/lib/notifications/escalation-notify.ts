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

const MAX_BODY_CRISIS = 120

/**
 * Alerta de CRISIS. Rompe idempotencia a propósito: SIEMPRE inserta una alerta
 * nueva (fan-out a todo el staff no-Doctor), aunque ya haya otra escalación viva.
 * body = el mensaje real del paciente (truncado). Nunca lanza.
 */
export async function notifyCrisis(params: {
  clinicId: string
  conversationId: string
  patientName: string | null
  patientMessage: string
}): Promise<void> {
  const { clinicId, conversationId, patientName, patientMessage } = params
  try {
    const displayName = patientName?.trim() || 'Paciente nuevo'
    const body = patientMessage.trim().length > MAX_BODY_CRISIS
      ? patientMessage.trim().slice(0, MAX_BODY_CRISIS) + '...'
      : patientMessage.trim()
    await createStaffNotification(
      clinicId,
      {
        type: 'crisis_detected',
        title: `🆘 CRISIS — ${displayName}`,
        body,
        metadata: { crisis: true },
        navigateTo: `/dashboard/conversations/${conversationId}`,
      },
      conversationId,
    )
  } catch (err) {
    console.error('[CAPA0] notifyCrisis falló (no crítico):', err)
  }
}

/**
 * Alerta de SOLICITUD ARCO (datos personales). Rompe idempotencia como crisis:
 * SIEMPRE inserta (fan-out a todo el staff no-Doctor), aunque ya haya otra
 * escalación viva. body = el mensaje real del paciente (truncado). El created_at
 * arranca el reloj del término legal de respuesta. Nunca lanza.
 */
export async function notifyDataRightsRequest(params: {
  clinicId: string
  conversationId: string
  patientName: string | null
  patientMessage: string
}): Promise<void> {
  const { clinicId, conversationId, patientName, patientMessage } = params
  try {
    const displayName = patientName?.trim() || 'Paciente nuevo'
    const body = patientMessage.trim().length > MAX_BODY_CRISIS
      ? patientMessage.trim().slice(0, MAX_BODY_CRISIS) + '...'
      : patientMessage.trim()
    await createStaffNotification(
      clinicId,
      {
        type: 'data_rights_request',
        title: `🔐 DATOS (ARCO) — ${displayName}`,
        body,
        metadata: { data_rights: true },
        navigateTo: `/dashboard/conversations/${conversationId}`,
      },
      conversationId,
    )
  } catch (err) {
    console.error('[CAPA0] notifyDataRightsRequest falló (no crítico):', err)
  }
}

/**
 * Fix de la "zona muerta": ante un mensaje nuevo a una conversación ya escalada,
 * refresca las alertas de escalación vivas (body al último mensaje + refreshed_at)
 * para que re-suban en la campana. Si NO hay ninguna viva (fue atendida pero la
 * conversación sigue escalada), crea una nueva vía notifyStaffOfEscalation.
 * Nunca lanza.
 */
export async function refreshEscalationNotifications(params: {
  conversationId: string
  clinicId: string
  patientName: string | null
  latestMessage: string
}): Promise<void> {
  const { conversationId, clinicId, patientName, latestMessage } = params
  try {
    const body = latestMessage.trim().length > MAX_BODY
      ? latestMessage.trim().slice(0, MAX_BODY) + '...'
      : latestMessage.trim()
    const { data: updated } = await supabaseAdmin
      .from('staff_notifications')
      .update({ body, refreshed_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('type', 'conversation_escalated')
      .is('read_at', null)
      .select('id')

    if (!updated || updated.length === 0) {
      // No hay alerta viva (atendida antes) pero la conversación sigue escalada
      // y el paciente volvió a escribir → crear una nueva.
      await notifyStaffOfEscalation({ clinicId, conversationId, patientName, reason: latestMessage })
    }
  } catch (err) {
    console.error('[CAPA0] refreshEscalationNotifications falló (no crítico):', err)
  }
}
