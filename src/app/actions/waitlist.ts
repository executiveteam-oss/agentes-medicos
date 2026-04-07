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

/** Confirmar solicitud de cita manual → crea cita + cierra waitlist entry */
export async function confirmManualBooking(
  entryId: string,
  startsAt: string,   // ISO 8601 con tz
  durationMinutes?: number
): Promise<{ ok: boolean; error?: string; appointmentId?: string }> {
  try {
    const clinicId = await checkWritePermission('espera')

    // Obtener la entrada con datos del paciente y doctor
    const { data: entry, error } = await supabaseAdmin
      .from('waitlist')
      .select('*, patients(id, name, phone), doctors(id, name, specialty)')
      .eq('id', entryId)
      .eq('clinic_id', clinicId)
      .single()

    if (error || !entry) return { ok: false, error: 'Entrada no encontrada' }

    const patient = entry.patients as { id: string; name: string; phone: string } | null
    const doctor = entry.doctors as { id: string; name: string; specialty: string | null } | null
    if (!patient || !doctor) return { ok: false, error: 'Datos incompletos' }

    // Obtener duración por defecto de la clínica
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('consultation_duration_minutes')
      .eq('id', clinicId)
      .single()

    const duration = durationMinutes ?? clinic?.consultation_duration_minutes ?? 30
    const start = new Date(startsAt)
    const end = new Date(start.getTime() + duration * 60 * 1000)

    // Crear cita
    const { data: appointment, error: aptError } = await supabaseAdmin
      .from('appointments')
      .insert({
        clinic_id: clinicId,
        doctor_id: doctor.id,
        patient_id: patient.id,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: 'confirmed',
        reason: entry.consultation_type_name ?? entry.reason ?? null,
        source: 'dashboard',
      })
      .select('id')
      .single()

    if (aptError || !appointment) return { ok: false, error: 'Error creando cita' }

    // Cerrar entrada de waitlist
    await supabaseAdmin
      .from('waitlist')
      .update({ status: 'booked' })
      .eq('id', entryId)
      .eq('clinic_id', clinicId)

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'manual_booking_confirmed',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: appointment.id,
      details: { waitlist_id: entryId, patient_name: patient.name, doctor_name: doctor.name },
    })

    // Notificar al paciente por WhatsApp
    const { formatTimeForPatient, formatDateForPatient } = await import('@/lib/utils/dates')
    const mensaje =
      `¡Hola ${patient.name}! ✅ Tu cita ha sido confirmada:\n\n` +
      `📅 ${formatDateForPatient(start.toISOString())}\n` +
      `🕐 ${formatTimeForPatient(start.toISOString())}\n` +
      `👨‍⚕️ ${doctor.name}\n\n` +
      `Si necesitas cambiar algo, escríbenos.`

    const phone = patient.phone.replace('+', '')
    await sendWhatsAppMessage(phone, mensaje)

    revalidatePath('/dashboard/espera')
    revalidatePath('/dashboard')
    return { ok: true, appointmentId: appointment.id }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Descartar solicitud de cita manual */
export async function discardManualRequest(
  entryId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('espera')

    const { error } = await supabaseAdmin
      .from('waitlist')
      .update({ status: 'expired' })
      .eq('id', entryId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error descartando solicitud' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'manual_booking_discarded',
      actor_type: 'staff',
      target_type: 'waitlist',
      target_id: entryId,
      details: { reason },
    })

    revalidatePath('/dashboard/espera')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Error de permisos o sesión' }
  }
}

/** Contar solicitudes manuales pendientes (para badge del sidebar) */
export async function countPendingManualRequests(): Promise<number> {
  try {
    const clinicId = await getSessionClinicId()

    const { count } = await supabaseAdmin
      .from('waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'waiting')
      .eq('source', 'whatsapp')

    return count ?? 0
  } catch {
    return 0
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
