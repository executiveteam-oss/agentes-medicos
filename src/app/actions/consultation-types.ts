'use server'

// ============================================================
// Server Actions — Tipos de consulta por doctor
// CRUD completo, filtrado por clinic_id
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission, extractActionError } from '@/lib/actions-helpers'
import type { ConsultationType, ConsultationModality } from '@/types/database'

// --- Tipos ---

export interface ConsultationTypeInput {
  doctor_id: string
  name: string
  duration_minutes: number
  requires_preparation: boolean
  preparation_instructions: string | null
  price: number | null
  is_active: boolean
  bookable_via_whatsapp: boolean
  non_bookable_message?: string | null
  requires_documents: boolean
  required_documents_description: string | null
  modality: ConsultationModality
  eps_name?: string | null
  requires_free_text_reason?: boolean
  free_text_reason_prompt?: string | null
}

/**
 * Obtener tipos de consulta de un doctor
 */
export async function getConsultationTypes(doctorId: string): Promise<ConsultationType[]> {
  const clinicId = await checkReadPermission('whatsapp')

  const { data, error } = await supabaseAdmin
    .from('consultation_types')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[getConsultationTypes] Error:', error)
    return []
  }

  return (data ?? []) as ConsultationType[]
}

/**
 * Obtener todos los tipos de consulta de la clínica (para todos los doctores)
 */
export async function getAllConsultationTypes(): Promise<ConsultationType[]> {
  const clinicId = await checkReadPermission('whatsapp')

  const { data, error } = await supabaseAdmin
    .from('consultation_types')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('doctor_id, created_at')

  if (error) {
    console.error('[getAllConsultationTypes] Error:', error)
    return []
  }

  return (data ?? []) as ConsultationType[]
}

/**
 * Crear un tipo de consulta
 */
export async function createConsultationType(
  input: ConsultationTypeInput
): Promise<{ ok: boolean; data?: ConsultationType; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  if (!input.name.trim()) {
    return { ok: false, error: 'El nombre es obligatorio' }
  }
  if (input.duration_minutes < 5 || input.duration_minutes > 480) {
    return { ok: false, error: 'La duración debe estar entre 5 y 480 minutos' }
  }

  const { data, error } = await supabaseAdmin
    .from('consultation_types')
    .insert({
      clinic_id: clinicId,
      doctor_id: input.doctor_id,
      name: input.name.trim(),
      duration_minutes: input.duration_minutes,
      requires_preparation: input.requires_preparation,
      preparation_instructions: input.requires_preparation ? input.preparation_instructions?.trim() || null : null,
      price: input.price,
      is_active: input.is_active,
      bookable_via_whatsapp: input.bookable_via_whatsapp ?? true,
      non_bookable_message: !input.bookable_via_whatsapp ? (input.non_bookable_message?.trim() || null) : null,
      requires_documents: input.requires_documents ?? false,
      required_documents_description: input.requires_documents ? input.required_documents_description?.trim() || null : null,
      modality: input.modality ?? 'presencial',
      eps_name: input.eps_name?.trim() || null,
      requires_free_text_reason: input.requires_free_text_reason ?? false,
      free_text_reason_prompt: input.requires_free_text_reason ? (input.free_text_reason_prompt?.trim() || null) : null,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[createConsultationType] Error:', error)
    return { ok: false, error: 'Error creando tipo de consulta' }
  }

  // Audit log
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'consultation_type_created',
      actor_type: 'staff',
      target_type: 'consultation_type',
      target_id: data.id,
      details: { name: input.name, doctor_id: input.doctor_id },
    })
  } catch { /* no crítico */ }

  return { ok: true, data: data as ConsultationType }
}

/**
 * Actualizar un tipo de consulta
 */
export async function updateConsultationType(
  id: string,
  input: Partial<ConsultationTypeInput>
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.duration_minutes !== undefined) updateData.duration_minutes = input.duration_minutes
  if (input.requires_preparation !== undefined) {
    updateData.requires_preparation = input.requires_preparation
    if (!input.requires_preparation) {
      updateData.preparation_instructions = null
    }
  }
  if (input.preparation_instructions !== undefined) updateData.preparation_instructions = input.preparation_instructions?.trim() || null
  if (input.price !== undefined) updateData.price = input.price
  if (input.is_active !== undefined) updateData.is_active = input.is_active
  if (input.bookable_via_whatsapp !== undefined) {
    updateData.bookable_via_whatsapp = input.bookable_via_whatsapp
    if (!input.bookable_via_whatsapp) {
      updateData.non_bookable_message = input.non_bookable_message?.trim() || null
    } else {
      updateData.non_bookable_message = null
    }
  }
  if (input.requires_documents !== undefined) {
    updateData.requires_documents = input.requires_documents
    if (!input.requires_documents) {
      updateData.required_documents_description = null
    }
  }
  if (input.required_documents_description !== undefined) updateData.required_documents_description = input.required_documents_description?.trim() || null
  if (input.modality !== undefined) updateData.modality = input.modality
  if (input.eps_name !== undefined) updateData.eps_name = input.eps_name?.trim() || null
  if (input.requires_free_text_reason !== undefined) {
    updateData.requires_free_text_reason = input.requires_free_text_reason
    updateData.free_text_reason_prompt = input.requires_free_text_reason ? (input.free_text_reason_prompt?.trim() || null) : null
  }

  const { error } = await supabaseAdmin
    .from('consultation_types')
    .update(updateData)
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) {
    console.error('[updateConsultationType] Error:', error)
    return { ok: false, error: 'Error actualizando tipo de consulta' }
  }

  // Audit log
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'consultation_type_updated',
      actor_type: 'staff',
      target_type: 'consultation_type',
      target_id: id,
      details: updateData,
    })
  } catch { /* no crítico */ }

  return { ok: true }
}

/**
 * Eliminar tipo de consulta (solo si no tiene citas futuras asociadas)
 */
export async function deleteConsultationType(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  // Verificar que no haya citas futuras con este tipo
  const { count } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('consultation_type_id', id)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', new Date().toISOString())

  if (count && count > 0) {
    return { ok: false, error: `No se puede eliminar: tiene ${count} cita(s) futuras asociadas` }
  }

  const { error } = await supabaseAdmin
    .from('consultation_types')
    .delete()
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) {
    console.error('[deleteConsultationType] Error:', error)
    return { ok: false, error: 'Error eliminando tipo de consulta' }
  }

  // Audit log
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'consultation_type_deleted',
      actor_type: 'staff',
      target_type: 'consultation_type',
      target_id: id,
    })
  } catch { /* no crítico */ }

  return { ok: true }
}

/**
 * Activar/desactivar tipo de consulta
 */
export async function toggleConsultationType(
  id: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  return updateConsultationType(id, { is_active: isActive })
}

/**
 * Clasificar manualmente un tipo de consulta como EPS o Prepagada (migración 00071).
 * Setea el flag insurer_type_set_by_staff=true para que el sync de iSalud (futuro UPDATE)
 * no sobrescriba la decisión manual.
 *
 * @param insurerType 'EPS' | 'Prepagada' | null (null para "des-clasificar")
 */
export async function classifyInsurerType(
  id: string,
  insurerType: 'EPS' | 'Prepagada' | null
): Promise<{ ok: boolean; error?: string }> {
  let clinicId: string
  try { clinicId = await checkWritePermission('whatsapp') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  if (insurerType !== null && insurerType !== 'EPS' && insurerType !== 'Prepagada') {
    return { ok: false, error: 'insurer_type inválido' }
  }

  const { error } = await supabaseAdmin
    .from('consultation_types')
    .update({
      insurer_type: insurerType,
      insurer_type_set_by_staff: insurerType !== null,
    })
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) {
    console.error('[classifyInsurerType] Error:', error)
    return { ok: false, error: 'Error clasificando tipo de consulta' }
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'consultation_type_insurer_classified',
      actor_type: 'staff',
      target_type: 'consultation_type',
      target_id: id,
      details: { insurer_type: insurerType },
    })
  } catch { /* no crítico */ }

  return { ok: true }
}
