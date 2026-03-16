'use server'

// ============================================================
// Server Actions — Lista de espera (CRUD + notificación)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { revalidatePath } from 'next/cache'
import { getSessionClinicId, checkWritePermission } from '@/lib/actions-helpers'
import type { WaitlistPriority } from '@/types/database'

/**
 * Notificar manualmente a un paciente en lista de espera
 * que hay un espacio disponible
 */
export async function notifyWaitlistEntry(waitlistId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()

    const { data: entry, error } = await supabaseAdmin
      .from('waitlist')
      .select('*, patients(name, phone)')
      .eq('id', waitlistId)
      .eq('clinic_id', clinicId)
      .single()

    if (error || !entry) {
      return { ok: false, error: 'Entrada no encontrada' }
    }

    const patient = entry.patients as { name: string; phone: string } | null
    if (!patient) return { ok: false, error: 'Paciente no encontrado' }

    const mensaje =
      `¡Hola ${patient.name}! 🎉 Tenemos un espacio disponible en el consultorio. ` +
      `¿Te gustaría agendar tu cita ahora? Responde "sí" para que te ayudemos.`

    const phone = patient.phone.replace('+', '')
    await sendWhatsAppMessage(phone, mensaje)

    // Actualizar estado a notificado
    await supabaseAdmin
      .from('waitlist')
      .update({
        status: 'notified',
        notified_at: new Date().toISOString(),
      })
      .eq('id', waitlistId)
      .eq('clinic_id', clinicId)

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'waitlist_patient_notified',
      actor_type: 'staff',
      target_type: 'waitlist',
      target_id: waitlistId,
      details: {},
    })

    revalidatePath('/dashboard/espera')
    return { ok: true }
  } catch (error) {
    console.error('[notifyWaitlistEntry]', error)
    return { ok: false, error: 'Error enviando notificación' }
  }
}

// ============================================================
// CRUD Lista de espera
// ============================================================

export interface WaitlistInput {
  patient_id: string
  doctor_id: string
  reason: string
  priority: WaitlistPriority
}

/** Agregar paciente a lista de espera */
export async function createWaitlistEntry(
  input: WaitlistInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('espera')

    if (!input.patient_id) return { ok: false, error: 'Selecciona un paciente' }
    if (!input.doctor_id) return { ok: false, error: 'Selecciona un doctor' }

    // Verificar que no esté ya en espera con el mismo doctor
    const { data: existing } = await supabaseAdmin
      .from('waitlist')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('patient_id', input.patient_id)
      .eq('doctor_id', input.doctor_id)
      .eq('status', 'waiting')
      .maybeSingle()

    if (existing) return { ok: false, error: 'El paciente ya está en lista de espera con este doctor' }

    const { data, error } = await supabaseAdmin
      .from('waitlist')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        doctor_id: input.doctor_id,
        reason: input.reason.trim() || null,
        priority: input.priority || 'normal',
        preferred_dates: [],
        preferred_time: 'any',
        status: 'waiting',
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: 'Error agregando a lista de espera' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'waitlist_entry_created',
      actor_type: 'staff',
      target_type: 'waitlist',
      target_id: data.id,
      details: { priority: input.priority },
    })

    revalidatePath('/dashboard/espera')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Actualizar entrada de lista de espera */
export async function updateWaitlistEntry(
  entryId: string,
  input: { reason: string; priority: WaitlistPriority }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('espera')

    const { error } = await supabaseAdmin
      .from('waitlist')
      .update({
        reason: input.reason.trim() || null,
        priority: input.priority || 'normal',
      })
      .eq('id', entryId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando entrada' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'waitlist_entry_updated',
      actor_type: 'staff',
      target_type: 'waitlist',
      target_id: entryId,
      details: { priority: input.priority },
    })

    revalidatePath('/dashboard/espera')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Remover de lista de espera */
export async function removeWaitlistEntry(
  entryId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('espera')

    const { error } = await supabaseAdmin
      .from('waitlist')
      .update({ status: 'expired' })
      .eq('id', entryId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error removiendo entrada' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'waitlist_entry_removed',
      actor_type: 'staff',
      target_type: 'waitlist',
      target_id: entryId,
      details: {},
    })

    revalidatePath('/dashboard/espera')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Obtener doctores activos para selects */
export async function getActiveDoctors(): Promise<{ id: string; name: string; specialty: string | null }[]> {
  try {
    const clinicId = await getSessionClinicId()

    const { data } = await supabaseAdmin
      .from('doctors')
      .select('id, name, specialty')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name')

    return data ?? []
  } catch {
    return []
  }
}
