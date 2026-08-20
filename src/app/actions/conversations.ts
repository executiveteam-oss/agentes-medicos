'use server'

// ============================================================
// Server Actions — Conversaciones (lectura + envío de mensajes)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { revalidatePath } from 'next/cache'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { getUserSession } from '@/lib/session'
import { resolveEscalationNotifications } from '@/lib/notifications/escalation-notify'
import { replyToHangingMessage } from '@/lib/agent/reply-to-hanging-message'
import { crisisReturnMissingReason } from '@/lib/rules/return-to-agent'
import { parseClaimConfig, resolveClaimState } from '@/lib/rules/claim-logic'
import type { ConversationStatus } from '@/types/database'
import { ESCALATION_REASONS, staffEscalationContext, historyOnReturn } from '@/lib/conversations/escalation-reasons'
import { serviciosPendientes, type ContextPendientes } from '@/lib/conversations/pendientes'

// ---- Tipos ----

export interface ConversationListItem {
  id: string
  patient_name: string
  patient_phone: string
  status: ConversationStatus
  last_message_at: string
  last_message_preview: string
  last_message_role: string
  message_count: number
}

export interface ConversationDetail {
  id: string
  patient_name: string
  patient_phone: string
  status: ConversationStatus
  escalated_to: string | null
  escalated_at: string | null
  created_at: string
}

export interface MessageItem {
  id: string
  role: string
  content: string
  message_type: string
  created_at: string
}

// ---- Lectura ----

/** Obtener lista de conversaciones con último mensaje */
export async function getConversations(
  statusFilter?: ConversationStatus | 'all',
  search?: string
): Promise<ConversationListItem[]> {
  const clinicId = await checkReadPermission('conversations')

  // Traer conversaciones con datos del paciente
  let query = supabaseAdmin
    .from('conversations')
    .select('id, status, last_message_at, whatsapp_phone, patients(name, phone)')
    .eq('clinic_id', clinicId)
    .order('last_message_at', { ascending: false })
    .limit(100)

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  }

  const { data: conversations, error } = await query

  if (error || !conversations) return []

  // Para cada conversación, obtener último mensaje y conteo
  const results: ConversationListItem[] = []

  for (const conv of conversations) {
    const patient = conv.patients as unknown as { name: string; phone: string } | null
    const patientName = patient?.name ?? 'Desconocido'
    const patientPhone = patient?.phone ?? conv.whatsapp_phone

    // Filtro de búsqueda
    if (search && search.trim()) {
      const s = search.toLowerCase().trim()
      const matchName = patientName.toLowerCase().includes(s)
      const matchPhone = patientPhone.includes(s)
      if (!matchName && !matchPhone) continue
    }

    // Último mensaje
    const { data: lastMsg } = await supabaseAdmin
      .from('messages')
      .select('content, role, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Conteo de mensajes
    const { count } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)

    results.push({
      id: conv.id,
      patient_name: patientName,
      patient_phone: patientPhone,
      status: conv.status as ConversationStatus,
      last_message_at: conv.last_message_at,
      last_message_preview: lastMsg
        ? lastMsg.content.length > 60
          ? lastMsg.content.slice(0, 60) + '...'
          : lastMsg.content
        : '',
      last_message_role: lastMsg?.role ?? '',
      message_count: count ?? 0,
    })
  }

  return results
}

/** Obtener detalle de una conversación */
export async function getConversationDetail(
  conversationId: string
): Promise<{ conversation: ConversationDetail; messages: MessageItem[] } | null> {
  const clinicId = await checkReadPermission('conversations')

  const { data: conv, error } = await supabaseAdmin
    .from('conversations')
    .select('id, status, escalated_to, escalated_at, created_at, whatsapp_phone, patients(name, phone)')
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
    .single()

  if (error || !conv) return null

  const patient = conv.patients as unknown as { name: string; phone: string } | null

  // Mensajes ordenados cronológicamente
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, message_type, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500)

  return {
    conversation: {
      id: conv.id,
      patient_name: patient?.name ?? 'Desconocido',
      patient_phone: patient?.phone ?? conv.whatsapp_phone,
      status: conv.status as ConversationStatus,
      escalated_to: conv.escalated_to,
      escalated_at: conv.escalated_at,
      created_at: conv.created_at,
    },
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      message_type: m.message_type,
      created_at: m.created_at,
    })),
  }
}

// ---- Escritura ----

/** Enviar mensaje manual como staff */
export async function sendStaffMessage(
  conversationId: string,
  content: string
): Promise<{ ok: boolean; error?: string; message?: MessageItem; tookOver?: boolean }> {
  try {
    const clinicId = await checkWritePermission('conversations')
    // Quién responde — para atribuir el mensaje (display) + el audit (registro
    // legal). Sin esto, el chat mostraba el nombre del que MIRA, no del que envió.
    const session = await getUserSession()
    if (!session) return { ok: false, error: 'Error de permisos o sesión' }

    if (!content.trim()) return { ok: false, error: 'El mensaje no puede estar vacío' }

    // Obtener datos de la conversación (incluye claim) y credenciales de la clínica
    const { data: conv, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('id, whatsapp_phone, clinic_id, status, context, claimed_by, claimed_by_name, claimed_at')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .single()

    if (convError || !conv) return { ok: false, error: 'Conversación no encontrada' }

    // Credenciales WhatsApp de la clínica
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_phone_id, whatsapp_access_token, feature_config')
      .eq('id', clinicId)
      .single()

    // Guardia de claim (modo duro) — evita doble-respuesta si el textarea del
    // cliente quedó habilitado por una condición de carrera con la propagación
    // realtime. En soft/disabled/mine/free NO cambia el comportamiento existente.
    const claimConfig = parseClaimConfig(clinic?.feature_config)
    if (claimConfig.enabled && claimConfig.mode === 'hard') {
      const cs = resolveClaimState(
        { claimed_by: conv.claimed_by, claimed_by_name: conv.claimed_by_name, claimed_at: conv.claimed_at },
        session.clinicUserId,
        claimConfig.expiryMinutes,
        Date.now()
      )
      if (cs.state === 'others') {
        return {
          ok: false,
          error: `Otra persona (${cs.byName}) está atendiendo esta conversación. Usa "Tomar de todos modos" para responder.`,
        }
      }
    }

    const clinicCreds = clinic?.whatsapp_phone_id && clinic?.whatsapp_access_token
      ? { phoneNumberId: clinic.whatsapp_phone_id, accessToken: clinic.whatsapp_access_token }
      : null

    // Enviar por WhatsApp
    const phone = conv.whatsapp_phone.replace('+', '')
    const waMessageId = await sendWhatsAppMessage(phone, content.trim(), clinicCreds)

    if (!waMessageId) return { ok: false, error: 'Error enviando mensaje por WhatsApp' }

    // Guardar en DB
    const { data: msg, error: msgError } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'staff',
        content: content.trim(),
        whatsapp_message_id: waMessageId,
        message_type: 'text',
        sender_name: session?.fullName ?? null,
        metadata: {},
      })
      .select('id, role, content, message_type, created_at, sender_name')
      .single()

    if (msgError) return { ok: false, error: 'Mensaje enviado pero error guardando en DB' }

    // ESCRIBIR = ATENDER YO. El mensaje PAUSA el agente (status='escalated' — el
    // webhook solo corta ahí) + reclama la conversación a mi nombre + triage
    // Atención. Sin esto el agente contestaba el próximo mensaje del paciente y
    // había doble atención (el bug más grave). `tookOver` = venía con el agente.
    const tookOver = (conv as { status?: string }).status === 'active'
    await supabaseAdmin
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        status: 'escalated',
        triage_state: 'atencion',
        context: staffEscalationContext(
          (conv as { context?: Record<string, unknown> | null }).context,
          ESCALATION_REASONS.STAFF_TAKEOVER,
          tookOver,
        ),
        claimed_by: session.clinicUserId,
        claimed_by_name: session.fullName,
        claimed_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)

    // Responder = atender: limpia la alerta de escalación (la 🆘 de crisis
    // sobrevive — resolveEscalationNotifications solo limpia conversation_escalated).
    await resolveEscalationNotifications(conversationId)

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'staff_message_sent',
      actor_type: 'staff',
      actor_id: session?.clinicUserId ?? null,
      target_type: 'conversation',
      target_id: conversationId,
      details: { sender_name: session?.fullName ?? null },
    })

    revalidatePath(`/dashboard/conversations/${conversationId}`)
    revalidatePath('/dashboard/conversations')

    return {
      ok: true,
      tookOver,
      message: {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        message_type: msg.message_type,
        created_at: msg.created_at,
      },
    }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * ATENDER YO (Eje A). Pausa el agente + reclama la conversación a mi nombre +
 * triage Atención. Es la mitad "humano" del par con returnConversationToAgent.
 * Disponible en CUALQUIER estado (no hay que escalar primero). Si otra persona
 * la tenía tomada, la toma para mí (modelo blando — sin dueño formal). La 🆘 de
 * crisis sobrevive (resolveEscalationNotifications no la toca).
 */
export async function takeOverConversation(
  conversationId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('conversations')
    const session = await getUserSession()
    if (!session) return { ok: false, error: 'Error de permisos o sesión' }

    // Estado previo: si venía con el agente, la causa de la escalación es esta
    // acción. Si ya estaba escalada, la causa original manda.
    const { data: antes } = await supabaseAdmin
      .from('conversations')
      .select('status, context')
      .eq('id', conversationId).eq('clinic_id', clinicId).maybeSingle()

    const { error } = await supabaseAdmin
      .from('conversations')
      .update({
        status: 'escalated',
        triage_state: 'atencion',
        context: staffEscalationContext(
          antes?.context as Record<string, unknown> | null,
          ESCALATION_REASONS.STAFF_TAKEOVER,
          antes?.status === 'active',
        ),
        claimed_by: session.clinicUserId,
        claimed_by_name: session.fullName,
        claimed_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
    if (error) return { ok: false, error: 'Error tomando la conversación' }

    await resolveEscalationNotifications(conversationId)

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'conversation_taken_over',
      actor_type: 'staff',
      actor_id: session.clinicUserId,
      target_type: 'conversation',
      target_id: conversationId,
      details: {},
    })

    revalidatePath(`/dashboard/conversations/${conversationId}`)
    revalidatePath('/dashboard/conversations')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Triage de bandeja: Atención / Pendiente / Resuelta. SEPARADO del flujo del
 *  agente. 'pendiente' se persiste (override); atención/resuelta se derivan del
 *  status. Abrir/leer NO llama a esto — el estado solo cambia por acción explícita. */
/**
 * "Ya lo gestioné" — cierra los servicios que la Capa 0 marcó para revisión
 * humana en esta conversación.
 *
 * 🔴 POR QUÉ EXISTE (2026-08-20)
 * La Capa 0 marcaba servicios y no había forma de cerrarlos: un solo escritor
 * que sólo agregaba. Sobre Algia eran 27 conversaciones marcadas y CERO con
 * señal de cierre — el campo no existía. El pendiente mandaba la conversación a
 * Atención y se quedaba ahí para siempre, aunque la secretaria ya hubiera
 * agendado el servicio el mismo día.
 *
 * Guarda QUIÉN y CUÁNDO. No toca el estado de la conversación ni el triage: si
 * la paciente además está esperando respuesta, sigue en Atención por ESE motivo,
 * que es otra pregunta. Cerrar el servicio no es cerrar la conversación.
 *
 * Idempotente: cerrar dos veces no rompe ni duplica el registro.
 */
export async function resolverServiciosMarcados(
  conversationId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('conversations')
    const session = await getUserSession()
    if (!session) return { ok: false, error: 'No autenticado' }

    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('context')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .single()
    if (!conv) return { ok: false, error: 'Conversación no encontrada' }

    const ctx = (conv.context ?? {}) as Record<string, unknown>
    const pendientes = serviciosPendientes(ctx as ContextPendientes)
    if (pendientes.length === 0) return { ok: true }   // ya estaba cerrado

    const yaResueltos = Array.isArray(ctx.servicios_resueltos) ? (ctx.servicios_resueltos as string[]) : []
    const ahora = new Date().toISOString()

    await supabaseAdmin
      .from('conversations')
      .update({
        context: {
          ...ctx,
          servicios_resueltos: [...yaResueltos, ...pendientes],
          servicios_resueltos_at: ahora,
          servicios_resueltos_por: session.clinicUserId,
          // El reloj de la cola se reinicia: si mañana la Capa 0 marca un
          // servicio NUEVO, el webhook le pone fecha propia en vez de heredar
          // la antigüedad de éste. Ver el bloque en lib/conversations/pendientes.
          servicios_marcados_at: null,
        },
      })
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'conversation_servicios_resueltos',
      actor_type: 'staff',
      actor_id: session.clinicUserId,
      target_type: 'conversation',
      target_id: conversationId,
      details: { servicios: pendientes, resueltos_por_nombre: session.fullName ?? null },
    })

    revalidatePath('/dashboard/conversations')
    revalidatePath(`/dashboard/conversations/${conversationId}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

export async function setConversationTriageState(
  conversationId: string,
  state: 'atencion' | 'pendiente' | 'resuelta',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('conversations')

    // Estado previo (para auditar de→a)
    const { data: prev } = await supabaseAdmin
      .from('conversations')
      .select('status, triage_state, context')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .single()
    const prevState = prev
      ? (prev.status === 'resolved' ? 'resuelta' : prev.triage_state === 'pendiente' ? 'pendiente' : 'atencion')
      : null

    const update: Record<string, unknown> =
      state === 'pendiente'
        ? { status: 'escalated', triage_state: 'pendiente' }            // vista pero abierta (sigue fuera del agente)
        : state === 'resuelta'
          ? { status: 'resolved', triage_state: null, claimed_by: null, claimed_by_name: null, claimed_at: null } // resuelta = done, libera el claim (no huérfano)
          : {
              status: 'escalated', triage_state: null, escalated_at: new Date().toISOString(),
              context: staffEscalationContext(
                prev?.context as Record<string, unknown> | null,
                ESCALATION_REASONS.STAFF_MANUAL,
                prev?.status === 'active',
              ),
            } // atención (deriva de escalated)

    const { error } = await supabaseAdmin
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
    if (error) return { ok: false, error: 'Error actualizando estado' }

    // Resolver = atender: limpia la alerta de escalación de esta conversación.
    if (state === 'resuelta') await resolveEscalationNotifications(conversationId)

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'conversation_state_changed',
      actor_type: 'staff',
      target_type: 'conversation',
      target_id: conversationId,
      details: { from: prevState, to: state },
    })

    revalidatePath(`/dashboard/conversations/${conversationId}`)
    revalidatePath('/dashboard/conversations')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Cambiar estado de conversación (resolved / escalated) */
export async function updateConversationStatus(
  conversationId: string,
  status: 'resolved' | 'escalated',
  escalatedTo?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('conversations')

    const updateData: Record<string, unknown> = { status }
    if (status === 'escalated') {
      updateData.escalated_at = new Date().toISOString()
      updateData.escalated_to = escalatedTo ?? 'doctor'
    }

    const { error } = await supabaseAdmin
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando conversación' }

    // Marcar resuelta = atender: limpia la alerta de escalación clinic-wide.
    if (status === 'resolved') {
      await resolveEscalationNotifications(conversationId)
    }

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: status === 'resolved' ? 'conversation_resolved' : 'conversation_escalated',
      actor_type: 'staff',
      target_type: 'conversation',
      target_id: conversationId,
      details: { escalated_to: escalatedTo },
    })

    revalidatePath(`/dashboard/conversations/${conversationId}`)
    revalidatePath('/dashboard/conversations')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * DEVOLVER AL AGENTE (Etapa 3). ACCIÓN aparte del selector de triage. Accesible
 * desde CUALQUIER conversación escalada. Flip a 'active', limpia la escalación,
 * y CONTESTA el mensaje colgado (no espera al próximo). NO toca la alerta 🆘
 * (resolveEscalationNotifications solo limpia conversation_escalated; crisis_
 * detected/data_rights_request son no-limpiables por diseño), igual que Resuelta.
 * Fricción: si el motivo de escalación fue 'crisis', el `reason` es OBLIGATORIO
 * (el checkbox es UI; acá se valida server-side).
 */
export async function returnConversationToAgent(
  conversationId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string; replied?: boolean; escalatedAgain?: boolean }> {
  try {
    const clinicId = await checkWritePermission('conversations')
    const session = await getUserSession()

    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('status, context')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .single()
    if (!conv) return { ok: false, error: 'Conversación no encontrada' }
    if (conv.status !== 'escalated') return { ok: false, error: 'La conversación no está escalada' }

    const escReason = (conv.context as Record<string, unknown> | null)?.escalation_reason as string | undefined

    // Fricción server-side: crisis exige motivo (el checkbox + textarea son UI).
    if (crisisReturnMissingReason(escReason, reason)) {
      return { ok: false, error: 'Para devolver una conversación de crisis, el motivo es obligatorio.' }
    }

    // Flip a active — limpia la escalación (incluido escalation_reason del context)
    // Y LIBERA el claim: que siga el agente = ningún humano la atiende (antes el
    // claim quedaba huérfano). Es la mitad "agente" del par con takeOverConversation.
    const { error } = await supabaseAdmin
      .from('conversations')
      .update({
        status: 'active', escalated_to: null, escalated_at: null, triage_state: null,
        // NO se limpia a {} pelado: el motivo se guarda en el historial antes de
        // borrarse. Las escalaciones que el staff resolvió bien y devolvió son
        // justo las que contestan "¿hacía falta un humano?", y se borraban solas.
        context: historyOnReturn(conv.context as Record<string, unknown> | null),
        claimed_by: null, claimed_by_name: null, claimed_at: null,
      })
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
    if (error) return { ok: false, error: 'Error devolviendo la conversación' }

    // NO toca la 🆘: solo limpia conversation_escalated (igual que Resuelta).
    await resolveEscalationNotifications(conversationId)

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'conversation_returned_to_agent',
      actor_type: 'staff',
      actor_id: session?.clinicUserId ?? null,
      target_type: 'conversation',
      target_id: conversationId,
      details: { from_reason: escReason ?? null, reason: reason?.trim() ?? null },
    })

    // Contesta el mensaje colgado (no espera al próximo). Puede re-escalar.
    const reply = await replyToHangingMessage(conversationId)

    revalidatePath(`/dashboard/conversations/${conversationId}`)
    revalidatePath('/dashboard/conversations')
    return { ok: true, replied: reply.replied, escalatedAgain: reply.escalatedAgain }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Reabrir conversación (volver a active) */
export async function reopenConversation(
  conversationId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('conversations')

    const { error } = await supabaseAdmin
      .from('conversations')
      .update({ status: 'active', escalated_to: null, escalated_at: null })
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error reabriendo conversación' }

    // Reabrir = atender: limpia la alerta de escalación de esta conversación.
    await resolveEscalationNotifications(conversationId)

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'conversation_reopened',
      actor_type: 'staff',
      target_type: 'conversation',
      target_id: conversationId,
      details: {},
    })

    revalidatePath(`/dashboard/conversations/${conversationId}`)
    revalidatePath('/dashboard/conversations')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/**
 * Backfill del detalle: mensajes con created_at > sinceIso. Se llama al
 * (re)conectar realtime para recuperar lo perdido durante una caída. El chat
 * mergea por id (ya deduplica), así que traer de más es inofensivo.
 */
export async function getMessagesSince(
  conversationId: string,
  sinceIso: string,
): Promise<{ ok: boolean; messages?: { id: string; role: string; content: string; message_type: string; created_at: string; sender_name: string | null }[] }> {
  try {
    const clinicId = await checkReadPermission('conversations')
    const { data: conv } = await supabaseAdmin
      .from('conversations').select('id, clinic_id').eq('id', conversationId).single()
    if (!conv || (conv as { clinic_id: string }).clinic_id !== clinicId) return { ok: false }

    const { data } = await supabaseAdmin
      .from('messages')
      .select('id, role, content, message_type, created_at')
      .eq('conversation_id', conversationId)
      .gt('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(200)

    const messages = ((data ?? []) as Array<{ id: string; role: string; content: string; message_type: string; created_at: string }>)
      .map((m) => ({ ...m, sender_name: null }))
    return { ok: true, messages }
  } catch {
    return { ok: false }
  }
}
