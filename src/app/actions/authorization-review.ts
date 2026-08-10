'use server'

// ============================================================
// Server actions — Bloque 4 — Review de autorizaciones
//
// La secretaria/coordinadora desde el dashboard:
//   - Lista autorizaciones pendientes (conversation_media con
//     context='authorization' y reviewed_at IS NULL)
//   - Ve el archivo via URL firmada (audit_log de cada acceso)
//   - Aprueba: crea cita real con flag requires_authorization=true
//   - Rechaza: marca + envía mensaje al paciente con motivo
//
// Gate: checkAuthorizationReviewPermission (NO conversations.write).
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAuthorizationReviewPermission, extractActionError } from '@/lib/actions-helpers'
import { getUserSession } from '@/lib/session'
import { generateSignedMediaUrl } from '@/lib/whatsapp/media-handler'
import { getClinicCreds, sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { buildRejectPatientMessage, isRejectReasonKey, type RejectReasonKey } from '@/lib/rules/reject-reasons'
import { revalidatePath } from 'next/cache'

const WINDOW_24H_MS = 24 * 60 * 60 * 1000

// La consulta y el criterio viven en lib — los comparte con la tarjeta del
// dashboard, que no puede importar de un módulo 'use server'.
import { traerArchivosSinRevisar, type PendingAuthorization } from '@/lib/media/archivos-sin-revisar'

/**
 * La bandeja, para la pantalla.
 */
export async function listPendingAuthorizations(): Promise<{
  ok: boolean
  error?: string
  items?: PendingAuthorization[]
}> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  try {
    return { ok: true, items: await traerArchivosSinRevisar(clinicId) }
  } catch {
    return { ok: false, error: 'Error consultando archivos recibidos' }
  }
}

/**
 * Genera URL firmada del archivo (TTL 10 min).
 * Registra el acceso en audit_log (cada acceso, no resumido).
 */
export async function getAuthorizationFileUrl(
  mediaId: string,
): Promise<{ ok: boolean; error?: string; url?: string }> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const r = await generateSignedMediaUrl({
    mediaRowId: mediaId,
    clinicId,
    accessedByUserId: session.clinicUserId,
  })
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, url: r.url }
}

// approveAuthorizationAndCreateAppointment se BORRÓ (2026-08-10).
//
// Era código muerto: ninguna pantalla lo llamaba. Pero llevaba adentro el gate
// `if (m.context !== 'authorization') return …` — la misma condición que dejó
// inalcanzable el flujo de aprobar-y-agendar durante semanas, porque ese
// context no se asigna nunca. El día que alguien lo conectara, reintroducía el
// bug entero sin que nadie lo notara.
//
// Lo que hace falta ya existe: approveAndReturnToAgent (el agente agenda) y
// markMediaApproved (la secretaria agendó a mano). Ninguno filtra por context.

/**
 * Rechaza la autorización. NO crea cita. Marca el media con
 * review_decision='rejected' + motivo. Registra audit.
 *
 * El mensaje al paciente lo envía el staff manualmente (por ahora —
 * en futuro podemos automatizar con WhatsApp).
 */
export async function rejectAuthorization(params: {
  mediaId: string
  reasonKey: string
  freeText?: string
}): Promise<{ ok: boolean; error?: string; noticeSent?: boolean; windowClosed?: boolean }> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  if (!isRejectReasonKey(params.reasonKey)) {
    return { ok: false, error: 'Motivo de rechazo inválido' }
  }
  const reasonKey: RejectReasonKey = params.reasonKey
  const freeText = params.freeText?.trim() ?? ''
  if (reasonKey === 'otra' && freeText.length < 10) {
    return { ok: false, error: 'Para "Otra", escribe el motivo (mínimo 10 caracteres)' }
  }

  const { data: media } = await supabaseAdmin
    .from('conversation_media')
    .select('id, clinic_id, conversation_id, reviewed_at')
    .eq('id', params.mediaId)
    .single()
  if (!media || (media as { clinic_id: string }).clinic_id !== clinicId) {
    return { ok: false, error: 'Archivo no encontrado o no pertenece a esta clínica' }
  }
  const m = media as { id: string; clinic_id: string; conversation_id: string; reviewed_at: string | null }
  if (m.reviewed_at) return { ok: false, error: 'Este archivo ya fue revisado' }

  // Datos para el aviso a la paciente
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('whatsapp_phone, last_message_at')
    .eq('id', m.conversation_id)
    .single()
  const { data: clinicRow } = await supabaseAdmin
    .from('clinics').select('name').eq('id', clinicId).single()
  const clinicName = (clinicRow as { name: string } | null)?.name ?? 'la clínica'
  const phone = (conv as { whatsapp_phone: string | null } | null)?.whatsapp_phone ?? null
  const lastMsgAt = (conv as { last_message_at: string | null } | null)?.last_message_at ?? null

  const internalNotes = `[${reasonKey}]${freeText ? ' ' + freeText : ''}`
  const patientMsg = buildRejectPatientMessage(reasonKey, { clinicName, freeText })

  // Marcar rechazado (el motivo INTERNO va en review_notes, nunca crudo a la paciente)
  await supabaseAdmin
    .from('conversation_media')
    .update({
      reviewed_by: session.clinicUserId,
      reviewed_at: new Date().toISOString(),
      review_decision: 'rejected',
      review_notes: internalNotes,
    })
    .eq('id', params.mediaId)

  // Ventana de 24h: aprox por last_message_at (Meta es la verdad final; si en
  // realidad está cerrada, el envío falla y lo capturamos → noticeSent=false).
  const windowOpen = !!lastMsgAt && (Date.now() - new Date(lastMsgAt).getTime()) < WINDOW_24H_MS
  let noticeSent = false
  if (windowOpen && phone && patientMsg) {
    try {
      await sendWhatsAppMessage(phone, patientMsg, await getClinicCreds(clinicId), { clinicId, sendType: 'auth_rejection' })
      await supabaseAdmin.from('messages').insert({
        conversation_id: m.conversation_id, role: 'agent', content: patientMsg,
      })
      noticeSent = true
    } catch (err) {
      console.error('[rejectAuthorization] no se pudo enviar aviso libre:', err)
    }
  }
  // Fuera de 24h (o falla): NO se manda template todavía — no está aprobado por
  // Meta. Se cablea sendWhatsAppTemplate('autorizacion_ajuste') cuando aprueben.
  // Mientras, la secretaria ve windowClosed y avisa manual.

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'authorization_rejected',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation_media',
    target_id: params.mediaId,
    details: { reason_key: reasonKey, notes: internalNotes, notice_sent: noticeSent, window_open: windowOpen },
  })

  revalidatePath('/dashboard/conversations/autorizaciones')
  return { ok: true, noticeSent, windowClosed: !noticeSent }
}

/**
 * Marca un archivo de autorización como APROBADO (sin crear la cita — la cita
 * se crea con el AppointmentFormModal por el flujo normal). Idempotente.
 * En el slice chico NO se linkea authorization_media_id a la cita (eso lo
 * resuelve el rediseño completo con authorization_requests).
 */
export async function markMediaApproved(mediaId: string): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const { data: media } = await supabaseAdmin
    .from('conversation_media')
    .select('id, clinic_id, reviewed_at')
    .eq('id', mediaId)
    .single()
  if (!media || (media as { clinic_id: string }).clinic_id !== clinicId) {
    return { ok: false, error: 'Archivo no encontrado o no pertenece a esta clínica' }
  }
  if ((media as { reviewed_at: string | null }).reviewed_at) return { ok: true }

  await supabaseAdmin
    .from('conversation_media')
    .update({
      reviewed_by: session.clinicUserId,
      reviewed_at: new Date().toISOString(),
      review_decision: 'approved',
    })
    .eq('id', mediaId)

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'authorization_approved',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation_media',
    target_id: mediaId,
    details: {},
  })

  revalidatePath('/dashboard/conversations/autorizaciones')
  return { ok: true }
}

/**
 * #2b — Aprobar y DEVOLVER AL AGENTE: marca la media aprobada, desescala la
 * conversación (status=active) y le manda a la paciente un mensaje del agente
 * ofreciéndole agendar. El agente retoma por su flujo normal (check_availability
 * + create_appointment) en el próximo turno.
 *
 * TRABA conocida (Algia hoy): si el servicio tiene regla escalate_human, la capa
 * B del executor bloquea create_appointment → el agente re-escala. Por eso la UI
 * guía con el matcher determinista hacia "Agendar yo" en esos casos. Acá NO
 * podemos saber el servicio (sin authorization_requests), así que confiamos en la
 * guía de la UI.
 *
 * Ventana 24h: <24h → mensaje libre; >24h → NO se manda (template
 * autorizacion_aprobada pendiente de Meta) y se mantiene escalada para el staff.
 */
export async function approveAndReturnToAgent(
  mediaId: string,
): Promise<{ ok: boolean; error?: string; noticeSent?: boolean; windowClosed?: boolean }> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const { data: media } = await supabaseAdmin
    .from('conversation_media')
    .select('id, clinic_id, conversation_id, reviewed_at')
    .eq('id', mediaId)
    .single()
  if (!media || (media as { clinic_id: string }).clinic_id !== clinicId) {
    return { ok: false, error: 'Archivo no encontrado o no pertenece a esta clínica' }
  }
  const m = media as { id: string; clinic_id: string; conversation_id: string; reviewed_at: string | null }
  if (m.reviewed_at) return { ok: false, error: 'Este archivo ya fue revisado' }

  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('whatsapp_phone, last_message_at')
    .eq('id', m.conversation_id)
    .single()
  const phone = (conv as { whatsapp_phone: string | null } | null)?.whatsapp_phone ?? null
  const lastMsgAt = (conv as { last_message_at: string | null } | null)?.last_message_at ?? null
  const windowOpen = !!lastMsgAt && (Date.now() - new Date(lastMsgAt).getTime()) < WINDOW_24H_MS

  // Marcar aprobada (siempre)
  await supabaseAdmin
    .from('conversation_media')
    .update({ reviewed_by: session.clinicUserId, reviewed_at: new Date().toISOString(), review_decision: 'approved' })
    .eq('id', mediaId)

  const patientMsg = '¡Tu autorización quedó aprobada! ¿Qué día te queda bien para agendar tu cita?'
  let noticeSent = false
  if (windowOpen && phone) {
    try {
      await sendWhatsAppMessage(phone, patientMsg, await getClinicCreds(clinicId), { clinicId, sendType: 'auth_rejection' })
      await supabaseAdmin.from('messages').insert({
        conversation_id: m.conversation_id, role: 'agent', content: patientMsg,
      })
      // Desescalar SOLO si pudimos avisar: el agente retoma en el próximo turno.
      await supabaseAdmin.from('conversations').update({ status: 'active' }).eq('id', m.conversation_id)
      noticeSent = true
    } catch (err) {
      console.error('[approveAndReturnToAgent] no se pudo avisar:', err)
    }
  }
  // Ventana cerrada / falla: queda aprobada pero la conversación sigue escalada
  // (staff coordina) hasta que el template autorizacion_aprobada esté aprobado.

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'authorization_approved',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation_media',
    target_id: mediaId,
    details: { via: 'return_to_agent', notice_sent: noticeSent, window_open: windowOpen },
  })

  revalidatePath('/dashboard/conversations/autorizaciones')
  return { ok: true, noticeSent, windowClosed: !noticeSent }
}

/**
 * Últimos N mensajes de la conversación, para dar contexto al revisar el
 * documento (la secretaria ve qué se habló). Slice chico: sin persistir
 * servicio/convenio, el chat ES el contexto.
 */
export async function getConversationTail(
  conversationId: string,
  limit = 15,
): Promise<{ ok: boolean; error?: string; messages?: { role: string; content: string; created_at: string }[] }> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { data: conv } = await supabaseAdmin
    .from('conversations').select('id, clinic_id').eq('id', conversationId).single()
  if (!conv || (conv as { clinic_id: string }).clinic_id !== clinicId) {
    return { ok: false, error: 'Conversación no encontrada' }
  }

  const { data } = await supabaseAdmin
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  const messages = ((data ?? []) as { role: string; content: string; created_at: string }[]).reverse()
  return { ok: true, messages }
}

/** Médicos activos de la clínica, para el selector del modal de agendado. */
export async function getClinicDoctorsForReview(): Promise<{ id: string; name: string; specialty: string | null }[]> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch { return [] }

  const { data } = await supabaseAdmin
    .from('doctors')
    .select('id, name, specialty')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  return (data ?? []) as { id: string; name: string; specialty: string | null }[]
}

/**
 * Marca un archivo como revisado SIN decisión de aprobación/rechazo.
 * Para documentos generales (context != 'authorization') que la secretaria
 * solo necesita VER y luego sacar de la bandeja. No crea cita ni notifica al
 * paciente — es el "ya lo vi y lo gestioné" del flujo mínimo. Idempotente.
 */
export async function markMediaReviewed(
  mediaId: string,
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const { data: media } = await supabaseAdmin
    .from('conversation_media')
    .select('id, clinic_id, reviewed_at')
    .eq('id', mediaId)
    .single()
  if (!media || (media as { clinic_id: string }).clinic_id !== clinicId) {
    return { ok: false, error: 'Archivo no encontrado o no pertenece a esta clínica' }
  }
  if ((media as { reviewed_at: string | null }).reviewed_at) return { ok: true } // ya revisado

  await supabaseAdmin
    .from('conversation_media')
    .update({
      reviewed_by: session.clinicUserId,
      reviewed_at: new Date().toISOString(),
      review_decision: null,
    })
    .eq('id', mediaId)

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'media_marked_reviewed',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation_media',
    target_id: mediaId,
    details: {},
  })

  revalidatePath('/dashboard/conversations/autorizaciones')
  return { ok: true }
}
