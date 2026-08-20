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
import { esNumeroEnviable } from '@/lib/utils/whatsapp-url'

/** Tipo de envío — va al audit (`send_type`) y decide la alerta. */
export type WhatsAppSendType =
  | 'agent_reply' | 'agent_fallback' | 'crisis_containment' | 'human_handoff'
  | 'escalate_service' | 'data_rights_ack' | 'privacy_link' | 'new_patient'
  | 'reminder' | 'ics' | 'reactivation' | 'survey' | 'waitlist'
  | 'auth_rejection' | 'staff_appointment' | 'weekly_report' | 'morning_report'
  // Prueba manual del resumen diario contra un número propio. Va separado para
  // que un fallo de prueba no se cuente como un resumen que no le llegó a un médico.
  | 'morning_report_test'
  | 'contacto_general' | 'solicitud_orden'
  // Aviso de que una cita se MOVIÓ (fecha/hora/médico) desde el panel. Va
  // separado de 'reminder': si éste falla, la paciente va a ir el día viejo.
  | 'appointment_moved'
  // Aviso de una cita NUEVA cargada desde el panel. Si falla, la paciente tiene
  // una cita a su nombre y no lo sabe.
  | 'appointment_created'
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


// ============================================================
// NÚMERO MAL FORMADO — se corta ANTES de llamar a Meta.
//
// "Centro Médico Bolívar" tenía `phone = '+5730000000'`, que no es un celular
// colombiano: le faltan dígitos. Cada corrida de cada cron intentaba el envío,
// Meta lo rechazaba, y eso escribía un `whatsapp_send_failed` por día. El log
// de fallos es lo que se mira para detectar problemas REALES de entrega; un
// número que nunca va a funcionar lo llena de ruido hasta volverlo inútil.
//
// Un número mal escrito no es un fallo de entrega: es un dato malo. Se registra
// UNA vez —para que alguien lo arregle— y después se calla.
//
// Usa `esNumeroEnviable` (lib/utils/whatsapp-url), que vive al lado de
// `isValidColombianMobile` y comparte su normalización. NO exige formato
// colombiano: hay 7 pacientes con número de EE.UU., Panamá, México y Ecuador
// que reciben mensajes hoy, y cortarlas sería peor que el ruido en el log.
// ============================================================

/** Máscara estable y sin el número completo (Ley 1581: no loguear teléfonos).
 *  Determinista a propósito: es la clave con la que se deduplica el registro. */
function enmascarar(phone: string): string {
  const t = phone.trim()
  if (t.length <= 6) return '***'
  return `${t.slice(0, 5)}***${t.slice(-2)}`
}

/**
 * ¿Hay que abortar el envío porque el destino no es un celular colombiano?
 *
 * Devuelve true si NO se debe enviar. Registra el problema una sola vez por
 * (clínica, número): si el número se corrige y vuelve a fallar, se registra de
 * nuevo, porque ya es otro dato.
 *
 * NUNCA lanza — un problema registrando no puede romper un cron.
 */
export async function esDestinoInvalido(
  to: string | null | undefined,
  ctx?: { clinicId?: string; sendType?: WhatsAppSendType },
): Promise<boolean> {
  if (esNumeroEnviable(to)) return false

  const masked = enmascarar(to ?? '')
  console.warn(`[WhatsApp] Destino inválido (${masked}) — no se intenta el envío`)

  if (!ctx?.clinicId) return true

  try {
    // ¿Ya quedó registrado este número para esta clínica? Entonces no se repite.
    const { data: yaEsta } = await supabaseAdmin
      .from('audit_log')
      .select('id')
      .eq('clinic_id', ctx.clinicId)
      .eq('action', 'whatsapp_invalid_number')
      .eq('details->>to_masked', masked)
      .limit(1)

    if (!yaEsta || yaEsta.length === 0) {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: ctx.clinicId,
        action: 'whatsapp_invalid_number',
        actor_type: 'system',
        details: {
          to_masked: masked,
          send_type: ctx.sendType ?? 'other',
          motivo: 'El número no tiene forma de teléfono enviable. Si dice +57 debe ser +573XXXXXXXXX. Corregir el dato.',
        },
      })
      console.error(`[WhatsApp] 🚨 Número inválido registrado para clinic ${ctx.clinicId}: ${masked}`)
    }
  } catch { /* registrar no puede romper el envío */ }

  return true
}
