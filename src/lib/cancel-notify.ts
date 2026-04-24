// ============================================================
// Shared helper: cancel appointment + notify patient via WhatsApp
// Used by both single-cancel and blocked-date mass-cancel
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, getClinicCreds } from '@/lib/whatsapp/client'
import { formatTimeForPatient } from '@/lib/utils/dates'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export interface CancelNotifyResult {
  ok: boolean
  whatsappSent: boolean
  warning?: string
}

/**
 * Cancel a single appointment and send WhatsApp with reagendamiento options.
 * Returns whether WhatsApp was sent (may fail if patient has no phone or creds missing).
 */
export async function cancelAndNotifyPatient(
  appointmentId: string,
  clinicId: string,
  internalReason: string,
  patientReason?: string | null,
): Promise<CancelNotifyResult> {
  // 1. Get appointment + patient + doctor info
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('id, starts_at, doctor_id, reason, patients(name, phone), doctors(name)')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()

  if (!apt) return { ok: false, whatsappSent: false, warning: 'Cita no encontrada' }

  const patient = (Array.isArray(apt.patients) ? apt.patients[0] : apt.patients) as { name: string; phone: string } | null
  const doctor = (Array.isArray(apt.doctors) ? apt.doctors[0] : apt.doctors) as { name: string } | null

  // 2. Cancel the appointment
  await supabaseAdmin.from('appointments').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancellation_reason: internalReason.trim() || null,
    patient_cancellation_reason: patientReason?.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq('id', appointmentId)

  // 3. Audit log
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'appointment_cancelled_with_notification',
    actor_type: 'staff',
    target_type: 'appointment',
    target_id: appointmentId,
    details: { internalReason, patientReason, patientName: patient?.name },
  })

  // 4. Send WhatsApp if possible
  if (!patient?.phone) {
    return { ok: true, whatsappSent: false, warning: 'Cita cancelada. El paciente no tiene WhatsApp registrado — contactarlo manualmente.' }
  }

  const creds = await getClinicCreds(clinicId)
  if (!creds) {
    return { ok: true, whatsappSent: false, warning: 'Cita cancelada. WhatsApp no configurado — contactar al paciente manualmente.' }
  }

  const { data: clinic } = await supabaseAdmin.from('clinics').select('name').eq('id', clinicId).single()
  const clinicName = clinic?.name ?? 'el consultorio'
  const reasonText = patientReason?.trim() || 'por motivos del consultorio'
  const dateFormatted = format(parseISO(apt.starts_at as string), "EEEE d 'de' MMMM", { locale: es })
  const timeFormatted = formatTimeForPatient(apt.starts_at as string)
  const doctorName = doctor?.name ?? 'el doctor'

  // 5. Find next 3 slots
  const slotsMsg = await findNextSlotsForDoctor(clinicId, apt.doctor_id as string, new Date())

  const message =
    `Hola ${patient.name} 👋\n\n` +
    `Te escribimos de ${clinicName}. Lamentablemente tuvimos que cancelar tu cita con ${doctorName} del ${dateFormatted} a las ${timeFormatted} ${reasonText}. Te pedimos disculpas por el inconveniente.\n\n` +
    slotsMsg +
    `\n\nResponde a este mensaje y con gusto te reagendamos.`

  try {
    await sendWhatsAppMessage(patient.phone.replace('+', ''), message, creds)
  } catch (err) {
    console.error(`[cancelAndNotify] WhatsApp failed for ${patient.name}:`, err instanceof Error ? err.message : err)
    return { ok: true, whatsappSent: false, warning: 'Cita cancelada pero falló el envío de WhatsApp. Contactar manualmente.' }
  }

  // 6. Notify assigned staff (by specialty)
  try {
    const { getNotificationPhoneForSpecialty } = await import('@/app/actions/specialty-notifications')
    // Get doctor's specialty
    const { data: docInfo } = await supabaseAdmin.from('doctors').select('specialty').eq('id', apt.doctor_id as string).single()
    const specialty = docInfo?.specialty as string | null
    const staffPhone = await getNotificationPhoneForSpecialty(clinicId, specialty)
    if (staffPhone && creds) {
      const staffMsg = `📋 Cita cancelada: ${patient.name} con ${doctorName}, ${dateFormatted} ${timeFormatted}. Motivo: ${reasonText}. Se envió WhatsApp al paciente con opciones de reagendamiento.`
      await sendWhatsAppMessage(staffPhone.replace('+', ''), staffMsg, creds)
    }
  } catch { /* staff notification is non-critical */ }

  return { ok: true, whatsappSent: true }
}

/** Find 3 next available slots for a doctor in the next 14 days */
export async function findNextSlotsForDoctor(clinicId: string, doctorId: string, afterDate: Date): Promise<string> {
  const startSearch = new Date(afterDate)
  startSearch.setDate(startSearch.getDate() + 1)
  const endSearch = new Date(startSearch)
  endSearch.setDate(endSearch.getDate() + 14)

  const { data: doctor } = await supabaseAdmin.from('doctors').select('name').eq('id', doctorId).single()
  const doctorName = doctor?.name ?? 'el doctor'

  const { data: existing } = await supabaseAdmin
    .from('appointments')
    .select('starts_at')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .gte('starts_at', startSearch.toISOString())
    .lte('starts_at', endSearch.toISOString())

  const occupiedSet = new Set((existing ?? []).map((a) => a.starts_at))

  const freeSlots: string[] = []
  for (let d = 0; d < 14 && freeSlots.length < 3; d++) {
    const day = new Date(startSearch)
    day.setDate(day.getDate() + d)
    if (day.getDay() === 0) continue

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
    return `${doctorName} no tiene fechas cercanas disponibles. ¿Quieres que revisemos con otro doctor o que te avise cuando tenga espacio?`
  }

  return `Estas son las próximas opciones disponibles con ${doctorName}:\n\n` +
    freeSlots.map((s) => `- ${s}`).join('\n') +
    '\n\n¿Cuál te sirve? También puedo buscar otras fechas.'
}
