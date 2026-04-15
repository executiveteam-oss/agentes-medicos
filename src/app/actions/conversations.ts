'use server'

// ============================================================
// Server Actions — Conversaciones (lectura + envío de mensajes)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { revalidatePath } from 'next/cache'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import type { ConversationStatus } from '@/types/database'

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
): Promise<{ ok: boolean; error?: string; message?: MessageItem }> {
  try {
    const clinicId = await checkWritePermission('conversations')

    if (!content.trim()) return { ok: false, error: 'El mensaje no puede estar vacío' }

    // Obtener datos de la conversación y credenciales de la clínica
    const { data: conv, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('id, whatsapp_phone, clinic_id')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .single()

    if (convError || !conv) return { ok: false, error: 'Conversación no encontrada' }

    // Credenciales WhatsApp de la clínica
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_phone_id, whatsapp_access_token')
      .eq('id', clinicId)
      .single()

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
        metadata: {},
      })
      .select('id, role, content, message_type, created_at')
      .single()

    if (msgError) return { ok: false, error: 'Mensaje enviado pero error guardando en DB' }

    // Actualizar last_message_at
    await supabaseAdmin
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'staff_message_sent',
      actor_type: 'staff',
      target_type: 'conversation',
      target_id: conversationId,
      details: {},
    })

    revalidatePath(`/dashboard/conversations/${conversationId}`)
    revalidatePath('/dashboard/conversations')

    return {
      ok: true,
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
