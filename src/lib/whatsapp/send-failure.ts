// ============================================================
// ÚNICO registro de un fallo de envío WhatsApp. Antes cada sitio logueaba su
// FAILED y nadie lo veía (solo la respuesta del agente auditaba). Ahora todos
// pasan por acá: SIEMPRE audita (whatsapp_send_failed, la fila consultable),
// marca delivery_status si hay fila de mensaje, y ALERTA solo los tipos de
// ALERT_ON_SEND_FAILURE. El envío que agreguemos el mes que viene lo hereda
// con solo pasar el ctx.
// ============================================================
import { supabaseAdmin } from '@/lib/supabase/admin'
import { whatsappSendErrorReason } from '@/lib/whatsapp/send-error-reason'
import { createStaffNotification } from '@/lib/notifications/create-notification'

/** Tipo de envío — va al audit (`send_type`) y decide la alerta. */
export type WhatsAppSendType =
  | 'agent_reply' | 'agent_fallback' | 'crisis_containment' | 'human_handoff'
  | 'escalate_service' | 'data_rights_ack' | 'privacy_link' | 'new_patient'
  | 'reminder' | 'ics' | 'reactivation' | 'survey' | 'waitlist'
  | 'auth_rejection' | 'staff_appointment' | 'weekly_report' | 'morning_report'
  | 'contacto_general' | 'solicitud_orden'
  | 'other'

// ÚNICO lugar que decide qué fallo ALERTA vs solo AUDITA. Mismo patrón que
// BUSY_STATUSES / ALERTS_CLEARED_ON_ATTEND: para agregar un tipo, se agrega acá,
// no se va a buscar un if. Hoy solo la contención de crisis — bajo volumen,
// máximo riesgo (puede fallar mientras alguien cree que la paciente recibió
// ayuda). El resto va a audit consultable, sin ruido.
export const ALERT_ON_SEND_FAILURE: readonly WhatsAppSendType[] = ['crisis_containment']

/** ¿Este tipo de envío, al fallar, dispara alerta activa al staff? Puro. */
export function shouldAlertOnSendFailure(sendType: string): boolean {
  return (ALERT_ON_SEND_FAILURE as readonly string[]).includes(sendType)
}

export interface SendFailureContext {
  clinicId: string
  sendType: WhatsAppSendType
  conversationId?: string
  messageId?: string     // si hay fila de mensaje → marca delivery_status
  patientName?: string   // solo para el texto de la alerta de crisis
}

/**
 * Registra un fallo de envío. NUNCA lanza — un problema registrando no puede
 * romper el webhook ni un cron. Cada operación va en su propio try; la función
 * resuelve siempre.
 */
export async function recordWhatsAppSendFailure(
  ctx: SendFailureContext,
  err: { errorCode?: number; errorMessage?: string },
): Promise<void> {
  const reason = whatsappSendErrorReason(err.errorCode)

  // 1) Audit — SIEMPRE (fuente de la consulta de 24h). No necesita conversación.
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: ctx.clinicId,
      action: 'whatsapp_send_failed',
      actor_type: 'system',
      target_type: ctx.conversationId ? 'conversation' : null,
      target_id: ctx.conversationId ?? null,
      details: {
        send_type: ctx.sendType,
        meta_code: err.errorCode ?? null,
        meta_message: err.errorMessage ?? null,
        reason,
        message_id: ctx.messageId ?? null,
      },
    })
  } catch (e) {
    console.error('[recordWhatsAppSendFailure] audit falló (no crítico):', e instanceof Error ? e.message : e)
  }

  // 2) delivery_status — solo si hay fila de mensaje (envíos atados a conversación).
  if (ctx.messageId) {
    try {
      await supabaseAdmin.from('messages').update({ delivery_status: 'failed', delivery_error: reason }).eq('id', ctx.messageId)
    } catch (e) {
      console.error('[recordWhatsAppSendFailure] delivery_status falló (no crítico):', e instanceof Error ? e.message : e)
    }
  }

  // 3) ALERTA — solo los tipos de ALERT_ON_SEND_FAILURE (hoy: crisis).
  if (shouldAlertOnSendFailure(ctx.sendType)) {
    try {
      const who = ctx.patientName?.trim() || 'una paciente'
      await createStaffNotification(ctx.clinicId, {
        type: 'crisis_detected',
        title: `🆘 Contención de crisis NO enviada — ${who}`,
        body: `El mensaje de contención no llegó (${reason}). Contactá a la paciente YA.`,
        metadata: { send_failure: true, meta_code: err.errorCode ?? null },
        navigateTo: ctx.conversationId ? `/dashboard/conversations/${ctx.conversationId}` : '/dashboard/conversations',
      }, ctx.conversationId)
    } catch (e) {
      console.error('[recordWhatsAppSendFailure] alerta crisis falló (no crítico):', e instanceof Error ? e.message : e)
    }
  }
}
