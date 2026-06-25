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
import { revalidatePath } from 'next/cache'

export interface PendingAuthorization {
  media_id: string
  conversation_id: string
  patient_phone: string
  patient_name: string | null
  whatsapp_media_id: string | null
  mime_type: string | null
  filename: string | null
  size_bytes: number | null
  created_at: string
  conversation_escalation_reason: string | null
}

/**
 * Lista las autorizaciones pendientes de revisión para la clínica
 * del usuario logueado. Ordenadas por más antiguas primero (FIFO).
 */
export async function listPendingAuthorizations(): Promise<{
  ok: boolean
  error?: string
  items?: PendingAuthorization[]
}> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { data, error } = await supabaseAdmin
    .from('conversation_media')
    .select(`
      id,
      conversation_id,
      whatsapp_media_id,
      mime_type,
      filename,
      size_bytes,
      created_at,
      conversations:conversation_id (
        whatsapp_phone,
        context,
        patients:patient_id ( name )
      )
    `)
    .eq('clinic_id', clinicId)
    .eq('context', 'authorization')
    .is('reviewed_at', null)
    .order('created_at', { ascending: true })

  if (error) return { ok: false, error: 'Error consultando autorizaciones pendientes' }

  type ConvRow = { whatsapp_phone: string; context: Record<string, unknown> | null; patients?: { name: string } | { name: string }[] | null }
  const items: PendingAuthorization[] = (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string
      conversation_id: string
      whatsapp_media_id: string | null
      mime_type: string | null
      filename: string | null
      size_bytes: number | null
      created_at: string
      conversations: ConvRow | ConvRow[] | null
    }
    const conv = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations
    const patient = conv?.patients
      ? (Array.isArray(conv.patients) ? conv.patients[0] : conv.patients)
      : null
    return {
      media_id: r.id,
      conversation_id: r.conversation_id,
      patient_phone: conv?.whatsapp_phone ?? '',
      patient_name: patient?.name ?? null,
      whatsapp_media_id: r.whatsapp_media_id,
      mime_type: r.mime_type,
      filename: r.filename,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
      conversation_escalation_reason: (conv?.context as Record<string, unknown> | null)?.escalation_reason as string | null ?? null,
    }
  })

  return { ok: true, items }
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

/**
 * Aprueba la autorización + crea la cita.
 *
 * Recibe el slot elegido por el staff. La cita queda con
 * requires_authorization=true + authorization_validated_at/by + el
 * media_id linkeado (para auditoría).
 */
export async function approveAuthorizationAndCreateAppointment(params: {
  mediaId: string
  doctorId: string
  consultationTypeId: string
  startsAt: string  // ISO 8601 con offset
  durationMinutes: number
  patientId: string
  reviewNotes?: string
}): Promise<{ ok: boolean; error?: string; appointmentId?: string }> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  // Verificar que el media pertenezca a la clínica
  const { data: media } = await supabaseAdmin
    .from('conversation_media')
    .select('id, clinic_id, conversation_id, context, reviewed_at')
    .eq('id', params.mediaId)
    .single()
  if (!media || (media as { clinic_id: string }).clinic_id !== clinicId) {
    return { ok: false, error: 'Archivo no encontrado o no pertenece a esta clínica' }
  }
  const m = media as { id: string; clinic_id: string; conversation_id: string; context: string; reviewed_at: string | null }
  if (m.context !== 'authorization') return { ok: false, error: 'El archivo no es una autorización' }
  if (m.reviewed_at) return { ok: false, error: 'Esta autorización ya fue revisada' }

  // Buscar el convenio en la conversación (desde el último mensaje del agente o paciente)
  // Por simplicidad, el staff lo confirma manualmente en el form — acá lo tomamos del CT
  const { data: ct } = await supabaseAdmin
    .from('consultation_types')
    .select('eps_name')
    .eq('id', params.consultationTypeId)
    .single()
  const convenio = (ct as { eps_name: string | null } | null)?.eps_name ?? null

  const endsAt = new Date(new Date(params.startsAt).getTime() + params.durationMinutes * 60_000).toISOString()

  // Crear la cita
  const { data: apt, error: aptErr } = await supabaseAdmin
    .from('appointments')
    .insert({
      clinic_id: clinicId,
      doctor_id: params.doctorId,
      patient_id: params.patientId,
      starts_at: params.startsAt,
      ends_at: endsAt,
      status: 'confirmed',
      source: 'manual',
      consultation_type_id: params.consultationTypeId,
      requires_authorization: true,
      authorization_convenio: convenio,
      authorization_validated_at: new Date().toISOString(),
      authorization_validated_by: session.clinicUserId,
      authorization_media_id: params.mediaId,
    })
    .select('id')
    .single()

  if (aptErr || !apt) return { ok: false, error: `Error creando cita: ${aptErr?.message}` }

  // Marcar la media como aprobada
  await supabaseAdmin
    .from('conversation_media')
    .update({
      reviewed_by: session.clinicUserId,
      reviewed_at: new Date().toISOString(),
      review_decision: 'approved',
      review_notes: params.reviewNotes ?? null,
    })
    .eq('id', params.mediaId)

  // Cerrar la escalación de la conversación
  await supabaseAdmin
    .from('conversations')
    .update({
      status: 'resolved',
      last_message_at: new Date().toISOString(),
    })
    .eq('id', m.conversation_id)

  // Audit log
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'authorization_approved',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation_media',
    target_id: params.mediaId,
    details: {
      appointment_id: (apt as { id: string }).id,
      doctor_id: params.doctorId,
      consultation_type_id: params.consultationTypeId,
      starts_at: params.startsAt,
      convenio,
    },
  })

  revalidatePath('/dashboard/conversaciones')
  revalidatePath('/dashboard/agenda')
  return { ok: true, appointmentId: (apt as { id: string }).id }
}

/**
 * Rechaza la autorización. NO crea cita. Marca el media con
 * review_decision='rejected' + motivo. Registra audit.
 *
 * El mensaje al paciente lo envía el staff manualmente (por ahora —
 * en futuro podemos automatizar con WhatsApp).
 */
export async function rejectAuthorization(params: {
  mediaId: string
  reviewNotes: string
}): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkAuthorizationReviewPermission() }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  if (!params.reviewNotes || params.reviewNotes.trim().length < 10) {
    return { ok: false, error: 'Motivo del rechazo requerido (mínimo 10 caracteres)' }
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
  if (m.reviewed_at) return { ok: false, error: 'Esta autorización ya fue revisada' }

  await supabaseAdmin
    .from('conversation_media')
    .update({
      reviewed_by: session.clinicUserId,
      reviewed_at: new Date().toISOString(),
      review_decision: 'rejected',
      review_notes: params.reviewNotes.trim(),
    })
    .eq('id', params.mediaId)

  // Mantener la conversación escalada para que el staff coordine con el paciente
  await supabaseAdmin
    .from('conversations')
    .update({
      context: { escalation_reason: `Autorización rechazada: ${params.reviewNotes.trim()}` },
      last_message_at: new Date().toISOString(),
    })
    .eq('id', m.conversation_id)

  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'authorization_rejected',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation_media',
    target_id: params.mediaId,
    details: { reason: params.reviewNotes.trim() },
  })

  revalidatePath('/dashboard/conversaciones')
  return { ok: true }
}
