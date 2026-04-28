// ============================================================
// Create staff notifications for appointment changes
// Emits 1 notification per eligible staff member (non-Doctor roles)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatTimeForPatient } from '@/lib/utils/dates'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { NotificationPayload, NotificationType } from './types'

/**
 * Create notifications for all eligible staff in a clinic.
 * Recipients: all active clinic_users whose role is NOT 'Doctor'.
 */
export async function createStaffNotification(
  clinicId: string,
  payload: NotificationPayload
): Promise<number> {
  // Find recipients: active clinic_users with non-Doctor role
  const { data: recipients, error: recipErr } = await supabaseAdmin
    .from('clinic_users')
    .select('auth_user_id, clinic_roles!inner(name)')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .neq('clinic_roles.name', 'Doctor')

  if (recipErr) {
    console.error('[Notifications] Error querying recipients:', recipErr.message)
    return 0
  }

  if (!recipients || recipients.length === 0) {
    console.warn(`[Notifications] No eligible staff for clinic ${clinicId} — skipping`)
    return 0
  }

  // Deduplicate by auth_user_id (user could have multiple clinic_user rows theoretically)
  const uniqueUserIds = [...new Set(recipients.map((r) => r.auth_user_id as string))]

  // Batch insert
  const rows = uniqueUserIds.map((userId) => ({
    clinic_id: clinicId,
    recipient_user_id: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body ?? null,
    metadata: payload.metadata,
    navigate_to: payload.navigateTo,
  }))

  const { error: insertErr } = await supabaseAdmin
    .from('staff_notifications')
    .insert(rows)

  if (insertErr) {
    console.error('[Notifications] Error inserting:', insertErr.message)
    return 0
  }

  console.log(`[Notifications] Created ${rows.length} notifications for clinic ${clinicId} type=${payload.type}`)
  return rows.length
}

// ============================================================
// Helper: detect notification type + build payload from tool results
// Called from the WhatsApp webhook after agent executes tools
// ============================================================

interface AppointmentChangeParams {
  clinicId: string
  conversationId: string
  patientName: string
  patientId: string
  toolsUsed: string[]
}

/**
 * After the agent runs cancel/reschedule tools, detect the type and
 * create staff notifications with full context.
 */
export async function notifyStaffOfAppointmentChange(
  params: AppointmentChangeParams
): Promise<void> {
  const { clinicId, conversationId, patientName, patientId, toolsUsed } = params

  const hasCancellation = toolsUsed.includes('cancel_appointment')
  const hasReschedule = toolsUsed.includes('reschedule_appointment')

  if (!hasCancellation && !hasReschedule) return

  // Fetch the most recent appointment changes for this patient (last 5 min window)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  // Get cancelled appointment (if any)
  let cancelledApt = null
  if (hasCancellation) {
    const { data } = await supabaseAdmin
      .from('appointments')
      .select('id, starts_at, doctor_id, doctors(name)')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('status', 'cancelled')
      .gte('cancelled_at', fiveMinAgo)
      .order('cancelled_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    cancelledApt = data
  }

  // Get new/rescheduled appointment (if any)
  let newApt = null
  if (hasReschedule) {
    const { data } = await supabaseAdmin
      .from('appointments')
      .select('id, starts_at, doctor_id, doctors(name)')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('source', 'whatsapp_agent')
      .in('status', ['confirmed', 'rescheduled'])
      .gte('created_at', fiveMinAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    newApt = data
  }

  // Determine type and build message
  let type: NotificationType
  let title: string
  let body: string | undefined

  const doctorsRaw = (cancelledApt?.doctors ?? newApt?.doctors) as unknown
  const doctorName = (Array.isArray(doctorsRaw) ? (doctorsRaw[0] as { name: string })?.name : (doctorsRaw as { name: string } | null)?.name) ?? 'el doctor'
  const doctorId = (cancelledApt?.doctor_id ?? newApt?.doctor_id) as string ?? ''

  if (hasCancellation && hasReschedule && cancelledApt && newApt) {
    // MOVED: cancelled + rescheduled in same conversation
    type = 'appointment_moved'
    const oldDate = formatShortDate(cancelledApt.starts_at as string)
    const newDate = formatShortDate(newApt.starts_at as string)
    title = `${patientName} movio su cita`
    body = `De ${oldDate} a ${newDate} con ${doctorName}`
  } else if (hasReschedule && newApt) {
    // RESCHEDULED only
    type = 'appointment_rescheduled'
    const newDate = formatShortDate(newApt.starts_at as string)
    title = `${patientName} reagendo su cita`
    body = `Nueva fecha: ${newDate} con ${doctorName}`
  } else if (hasCancellation && cancelledApt) {
    // CANCELLED only
    type = 'appointment_canceled'
    const oldDate = formatShortDate(cancelledApt.starts_at as string)
    title = `${patientName} cancelo su cita`
    body = `${oldDate} con ${doctorName}`
  } else {
    // Tools were used but we couldn't find the appointments — log and skip
    console.warn(`[Notifications] Could not find appointments for tools ${toolsUsed.join(',')} patient=${patientId}`)
    return
  }

  await createStaffNotification(clinicId, {
    type,
    title,
    body,
    metadata: {
      patient_id: patientId,
      patient_name: patientName,
      doctor_id: doctorId,
      doctor_name: doctorName,
      conversation_id: conversationId,
      appointment_id: (cancelledApt?.id ?? newApt?.id) as string,
      old_appointment_id: cancelledApt?.id as string | undefined,
      new_appointment_id: newApt?.id as string | undefined,
      old_starts_at: cancelledApt?.starts_at as string | undefined,
      new_starts_at: newApt?.starts_at as string | undefined,
    },
    navigateTo: `/dashboard/conversations/${conversationId}`,
  })
}

function formatShortDate(iso: string): string {
  try {
    const d = parseISO(iso)
    return `${format(d, "EEE d MMM", { locale: es })} ${formatTimeForPatient(iso)}`
  } catch {
    return iso
  }
}
