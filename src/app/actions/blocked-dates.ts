'use server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, checkWritePermission } from '@/lib/actions-helpers'
import { sendWhatsAppMessage, getClinicCreds } from '@/lib/whatsapp/client'
import { formatTimeForPatient } from '@/lib/utils/dates'
import { revalidatePath } from 'next/cache'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export interface BlockedDate {
  id: string
  clinic_id: string
  doctor_id: string | null
  start_date: string
  end_date: string
  reason: string | null
  patient_reason: string | null
  created_at: string
}

export interface AffectedAppointment {
  id: string
  starts_at: string
  patient_name: string
  patient_phone: string
  doctor_name: string
  reason: string | null
}

export async function getBlockedDatesForDoctor(doctorId: string): Promise<BlockedDate[]> {
  const clinicId = await checkReadPermission('whatsapp')
  const { data } = await supabaseAdmin
    .from('blocked_dates')
    .select('*')
    .eq('clinic_id', clinicId)
    .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
    .order('start_date', { ascending: true })
  return (data ?? []) as BlockedDate[]
}

export async function getBlockedDatesForClinic(): Promise<BlockedDate[]> {
  const clinicId = await checkReadPermission('whatsapp')
  const { data } = await supabaseAdmin
    .from('blocked_dates')
    .select('*')
    .eq('clinic_id', clinicId)
    .is('doctor_id', null)
    .order('start_date', { ascending: true })
  return (data ?? []) as BlockedDate[]
}

/** Consultar citas que se verían afectadas por un bloqueo ANTES de crearlo */
export async function getAffectedAppointments(input: {
  doctorId?: string | null
  startDate: string
  endDate: string
}): Promise<AffectedAppointment[]> {
  const clinicId = await checkReadPermission('whatsapp')

  let query = supabaseAdmin
    .from('appointments')
    .select('id, starts_at, reason, doctor_id, patients(name, phone), doctors(name)')
    .eq('clinic_id', clinicId)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', `${input.startDate}T00:00:00-05:00`)
    .lte('starts_at', `${input.endDate}T23:59:59-05:00`)
    .order('starts_at')

  if (input.doctorId) {
    query = query.eq('doctor_id', input.doctorId)
  }

  const { data } = await query

  return (data ?? []).map((apt) => {
    const patient = (Array.isArray(apt.patients) ? apt.patients[0] : apt.patients) as { name: string; phone: string } | null
    const doctor = (Array.isArray(apt.doctors) ? apt.doctors[0] : apt.doctors) as { name: string } | null
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      patient_name: patient?.name ?? 'Paciente',
      patient_phone: patient?.phone ?? '',
      doctor_name: doctor?.name ?? 'Doctor',
      reason: apt.reason as string | null,
    }
  })
}

/** Crear bloqueo + cancelar citas afectadas + notificar pacientes */
export async function createBlockedDate(input: {
  doctorId?: string | null
  startDate: string
  endDate: string
  reason?: string | null
  patientReason?: string | null
  cancelAndNotify?: boolean
}): Promise<{ ok: boolean; error?: string; cancelled?: number; notified?: number }> {
  const clinicId = await checkWritePermission('whatsapp')
  if (!input.startDate || !input.endDate) return { ok: false, error: 'Fechas obligatorias' }
  if (input.endDate < input.startDate) return { ok: false, error: 'La fecha fin debe ser igual o posterior' }

  // 1. Guardar bloqueo
  const { error: insertErr } = await supabaseAdmin.from('blocked_dates').insert({
    clinic_id: clinicId,
    doctor_id: input.doctorId || null,
    start_date: input.startDate,
    end_date: input.endDate,
    reason: input.reason?.trim() || null,
    patient_reason: input.patientReason?.trim() || null,
  })
  if (insertErr) return { ok: false, error: 'Error creando bloqueo' }

  let cancelled = 0
  let notified = 0

  // 2. Si hay citas y el admin confirmó → cancelar + notificar
  if (input.cancelAndNotify) {
    const affected = await getAffectedAppointments({
      doctorId: input.doctorId,
      startDate: input.startDate,
      endDate: input.endDate,
    })

    if (affected.length > 0) {
      // Cancelar todas
      const ids = affected.map((a) => a.id)
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled', cancellation_reason: input.patientReason?.trim() || input.reason?.trim() || 'Doctor/clínica no disponible' })
        .in('id', ids)
      cancelled = ids.length

      // Obtener credenciales de WhatsApp
      const creds = await getClinicCreds(clinicId)

      // Obtener nombre de la clínica
      const { data: clinic } = await supabaseAdmin.from('clinics').select('name').eq('id', clinicId).single()
      const clinicName = clinic?.name ?? 'el consultorio'

      // Notificar cada paciente
      for (const apt of affected) {
        if (!apt.patient_phone || !creds) continue

        const patientReason = input.patientReason?.trim() || 'por motivos del consultorio'
        const dateFormatted = format(parseISO(apt.starts_at), "EEEE d 'de' MMMM", { locale: es })
        const timeFormatted = formatTimeForPatient(apt.starts_at)

        // Buscar 3 próximos slots del mismo doctor después del bloqueo
        const slotsMsg = await findNextSlots(clinicId, apt, input)

        const message =
          `Hola ${apt.patient_name} 👋\n\n` +
          `Te escribimos de ${clinicName}. Lamentablemente tuvimos que cancelar tu cita con ${apt.doctor_name} del ${dateFormatted} a las ${timeFormatted} ${patientReason}. Te pedimos disculpas por el inconveniente.\n\n` +
          slotsMsg +
          `\n\nResponde a este mensaje y con gusto te reagendamos.`

        const whatsappNumber = apt.patient_phone.replace('+', '')
        try {
          await sendWhatsAppMessage(whatsappNumber, message, creds)
          notified++
        } catch (err) {
          console.error(`[BlockedDates] Error notificando ${apt.patient_name}:`, err instanceof Error ? err.message : err)
        }
      }

      // Audit log
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'blocked_date_cancel_notify',
        actor_type: 'staff',
        details: { startDate: input.startDate, endDate: input.endDate, doctorId: input.doctorId, cancelled, notified, reason: input.reason },
      })
    }
  }

  revalidatePath('/dashboard/whatsapp')
  revalidatePath('/dashboard/settings/clinic')
  revalidatePath('/dashboard')
  return { ok: true, cancelled, notified }
}

/** Buscar 3 próximos slots disponibles del mismo doctor después del bloqueo */
async function findNextSlots(
  clinicId: string,
  apt: AffectedAppointment,
  blockInput: { endDate: string; doctorId?: string | null }
): Promise<string> {
  // Buscar en los 14 días después del fin del bloqueo
  const startSearch = new Date(blockInput.endDate + 'T12:00:00-05:00')
  startSearch.setDate(startSearch.getDate() + 1)
  const endSearch = new Date(startSearch)
  endSearch.setDate(endSearch.getDate() + 14)

  // Buscar citas existentes del doctor en ese rango
  const doctorId = (apt as unknown as { doctor_id?: string }).doctor_id ?? blockInput.doctorId
  if (!doctorId) return 'Pronto te contactamos para reagendar.'

  const { data: existing } = await supabaseAdmin
    .from('appointments')
    .select('starts_at')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .gte('starts_at', startSearch.toISOString())
    .lte('starts_at', endSearch.toISOString())

  const occupiedSet = new Set((existing ?? []).map((a) => a.starts_at))

  // Generar slots libres (9 AM - 5 PM, cada 30 min)
  const freeSlots: string[] = []
  for (let d = 0; d < 14 && freeSlots.length < 3; d++) {
    const day = new Date(startSearch)
    day.setDate(day.getDate() + d)
    if (day.getDay() === 0) continue // domingo

    for (let h = 9; h < 17 && freeSlots.length < 3; h++) {
      for (const m of [0, 30]) {
        if (freeSlots.length >= 3) break
        const slot = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), h + 5, m))
        if (!occupiedSet.has(slot.toISOString())) {
          const dayStr = format(day, "EEEE d 'de' MMMM", { locale: es })
          const timeStr = formatTimeForPatient(slot.toISOString())
          freeSlots.push(`${dayStr} a las ${timeStr}`)
        }
      }
    }
  }

  if (freeSlots.length === 0) {
    return `${apt.doctor_name} no tiene fechas cercanas disponibles en los próximos días. ¿Quieres que revisemos con otro doctor, o prefieres que te avise cuando tenga espacio?`
  }

  return `Estas son las próximas opciones disponibles con ${apt.doctor_name}:\n\n` +
    freeSlots.map((s) => `- ${s}`).join('\n') +
    '\n\n¿Cuál te sirve? También puedo buscar otras fechas.'
}

export async function deleteBlockedDate(id: string): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await checkWritePermission('whatsapp')
  const { error } = await supabaseAdmin.from('blocked_dates').delete().eq('id', id).eq('clinic_id', clinicId)
  if (error) return { ok: false, error: 'Error eliminando bloqueo' }

  revalidatePath('/dashboard/whatsapp')
  revalidatePath('/dashboard/settings/clinic')
  return { ok: true }
}
