'use server'

// ============================================================
// Server Actions — CRUD de doctores desde /dashboard/whatsapp
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'

export interface CreateDoctorInput {
  name: string
  specialty: string
  phone: string
}

export interface UpdateDoctorInput {
  name: string
  specialty: string
}

export interface DoctorResult {
  id: string
  name: string
  specialty: string | null
  phone: string | null
  is_active: boolean
}

/** Crear un nuevo doctor */
export async function createDoctor(
  input: CreateDoctorInput
): Promise<{ ok: boolean; doctor?: DoctorResult; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    if (!input.name.trim()) {
      return { ok: false, error: 'El nombre es obligatorio' }
    }

    const { data, error } = await supabaseAdmin
      .from('doctors')
      .insert({
        clinic_id: clinicId,
        name: input.name.trim(),
        specialty: input.specialty.trim() || null,
        phone: input.phone.trim() || null,
        is_active: true,
      })
      .select('id, name, specialty, phone, is_active')
      .single()

    if (error) return { ok: false, error: 'Error creando doctor' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'doctor_created',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: data.id,
      details: { name: input.name.trim() },
    })

    revalidatePath('/dashboard/whatsapp')
    return { ok: true, doctor: data as DoctorResult }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Actualizar nombre y especialidad de un doctor */
export async function updateDoctor(
  doctorId: string,
  input: UpdateDoctorInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    if (!input.name.trim()) {
      return { ok: false, error: 'El nombre es obligatorio' }
    }

    const { error } = await supabaseAdmin
      .from('doctors')
      .update({
        name: input.name.trim(),
        specialty: input.specialty.trim() || null,
      })
      .eq('id', doctorId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando doctor' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'doctor_updated',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: doctorId,
      details: { name: input.name.trim(), specialty: input.specialty.trim() },
    })

    revalidatePath('/dashboard/whatsapp')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Activar o desactivar un doctor */
export async function toggleDoctorActive(
  doctorId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    const { error } = await supabaseAdmin
      .from('doctors')
      .update({ is_active: isActive })
      .eq('id', doctorId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando doctor' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: isActive ? 'doctor_activated' : 'doctor_deactivated',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: doctorId,
      details: {},
    })

    revalidatePath('/dashboard/whatsapp')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Cerrar agenda de un doctor */
export async function closeDoctorAgenda(
  doctorId: string,
  reason: string | null,
  until: string | null  // YYYY-MM-DD or null = indefinido
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    const { error } = await supabaseAdmin
      .from('doctors')
      .update({
        agenda_closed: true,
        agenda_closed_reason: reason?.trim() || null,
        agenda_closed_until: until || null,
      })
      .eq('id', doctorId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error cerrando agenda' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'agenda_closed',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: doctorId,
      details: { reason: reason?.trim() || null, until },
    })

    revalidatePath('/dashboard/whatsapp')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Reabrir agenda de un doctor */
export async function reopenDoctorAgenda(
  doctorId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    const { error } = await supabaseAdmin
      .from('doctors')
      .update({
        agenda_closed: false,
        agenda_closed_reason: null,
        agenda_closed_until: null,
      })
      .eq('id', doctorId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error reabriendo agenda' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'agenda_reopened',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: doctorId,
      details: {},
    })

    revalidatePath('/dashboard/whatsapp')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Actualizar tipo de horario del doctor */
export async function updateDoctorScheduleType(
  doctorId: string,
  scheduleType: 'fixed' | 'manual',
  manualMessage: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    const { error } = await supabaseAdmin
      .from('doctors')
      .update({
        schedule_type: scheduleType,
        manual_availability_message: scheduleType === 'manual' ? (manualMessage?.trim() || null) : null,
      })
      .eq('id', doctorId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando tipo de horario' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'doctor_schedule_type_updated',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: doctorId,
      details: { schedule_type: scheduleType },
    })

    revalidatePath('/dashboard/whatsapp')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Eliminar doctor (solo si no tiene citas futuras) */
export async function deleteDoctor(
  doctorId: string
): Promise<{ ok: boolean; error?: string; futureCount?: number }> {
  try {
    const clinicId = await checkWritePermission('whatsapp')

    // Verificar citas futuras
    const { count } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('doctor_id', doctorId)
      .eq('clinic_id', clinicId)
      .gte('starts_at', new Date().toISOString())
      .in('status', ['confirmed', 'rescheduled'])

    if (count && count > 0) {
      return {
        ok: false,
        futureCount: count,
        error: `Este médico tiene ${count} cita${count > 1 ? 's' : ''} futura${count > 1 ? 's' : ''}. Desactívalo en vez de eliminarlo.`,
      }
    }

    const { error } = await supabaseAdmin
      .from('doctors')
      .delete()
      .eq('id', doctorId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error eliminando doctor' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'doctor_deleted',
      actor_type: 'staff',
      target_type: 'doctor',
      target_id: doctorId,
      details: {},
    })

    revalidatePath('/dashboard/whatsapp')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}
