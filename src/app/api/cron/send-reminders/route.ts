// ============================================================
// CRON JOB: Enviar recordatorios de citas (72h, 24h, 2h)
// Se ejecuta diariamente (configurado en vercel.json)
//
// Mejoras:
// - 72h: Recordatorio 3 días antes (configurable por clínica)
// - 24h: Incluye instrucciones de preparación y docs si aplica
// - 2h:  Solo pacientes de alto riesgo (no_show_count >= 1
//         o cita agendada con >7 días de anticipación)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, getClinicCreds } from '@/lib/whatsapp/client'
import { formatDateForPatient, formatTimeForPatient } from '@/lib/utils/dates'
import { calculateNoShowProbability } from '@/lib/utils/noshow'
import { syncClinicSheet } from '@/lib/google-sheets'
import { checkRateLimit, RATE_LIMITS, verifyCronSecret } from '@/lib/rate-limit'
import type { NotificationSettings } from '@/types/database'

// Máximo tiempo de ejecución
export const maxDuration = 30

// Defaults para notification_settings
const NOTIFICATION_DEFAULTS: NotificationSettings = {
  reminder_72h: true,
  reminder_24h: true,
  reminder_2h: false,
  morning_report: true,
  morning_report_hour: '06:00',
  weekly_report: true,
  noshow_alert: false,
  noshow_alert_threshold: 30,
  overdue_billing_alert: false,
  overdue_billing_days: 30,
}

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    console.warn('[Cron:Reminders] Acceso no autorizado')
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const rateLimit = checkRateLimit('cron:send-reminders', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  console.log('[Cron:Reminders] Iniciando envío de recordatorios...')

  try {
    // Cargar notification_settings de todas las clínicas activas
    const { data: clinics } = await supabaseAdmin
      .from('clinics')
      .select('id, notification_settings')
      .in('subscription_status', ['trial', 'active'])

    const clinicSettings = new Map<string, NotificationSettings>()
    for (const c of clinics ?? []) {
      clinicSettings.set(c.id, {
        ...NOTIFICATION_DEFAULTS,
        ...(c.notification_settings as Partial<NotificationSettings> | null),
      })
    }

    // Ejecutar todos los tipos de recordatorios
    const [result72h, result24h, result2h] = await Promise.all([
      send72hReminders(clinicSettings),
      send24hReminders(clinicSettings),
      send2hReminders(clinicSettings),
    ])

    // Marcar citas sin confirmación como "no confirmadas"
    await markUnconfirmedAppointments()

    // Enviar links de videollamada para citas virtuales
    const virtualResult = await sendVirtualLinks()

    // Enviar recordatorios de documentos pendientes (48h)
    const docResult = await sendDocumentReminders()

    // Auto-timeout: reabrir conversaciones escaladas sin respuesta >24h
    const escalationTimeouts = await autoTimeoutEscalatedConversations()

    console.log(
      `[Cron:Reminders] Completado — 72h: ${result72h.sent}, 24h: ${result24h.sent}, 2h: ${result2h.sent}, ` +
      `virtual: ${virtualResult.sent}, docs: ${docResult.sent}, esc_timeout: ${escalationTimeouts}`
    )

    return NextResponse.json({
      status: 'ok',
      reminders_72h: result72h,
      reminders_24h: result24h,
      reminders_2h: result2h,
      virtual_links_sent: virtualResult.sent,
      document_reminders_sent: docResult.sent,
      escalation_timeouts: escalationTimeouts,
    })
  } catch (error) {
    console.error('[Cron:Reminders] Error general:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ============================================================
// IMPROVEMENT 1: Recordatorio 72h (3 días antes)
// Solo se envía si la clínica tiene reminder_72h = true
// ============================================================
async function send72hReminders(
  clinicSettings: Map<string, NotificationSettings>
): Promise<{ sent: number; failed: number }> {
  const now = new Date()
  const in71h = new Date(now.getTime() + 71.5 * 60 * 60 * 1000)
  const in73h = new Date(now.getTime() + 72.5 * 60 * 60 * 1000)

  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, clinic_id, patient_id, doctor_id,
      patients(name, phone),
      doctors(name, specialty),
      clinics(name, address, city)
    `)
    .in('status', ['confirmed', 'rescheduled'])
    .eq('reminder_72h_sent', false)
    .gte('starts_at', in71h.toISOString())
    .lte('starts_at', in73h.toISOString())

  if (error) {
    console.error('[Cron:72h] Error consultando citas:', error)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const apt of appointments ?? []) {
    // Verificar que la clínica tenga habilitado el recordatorio 72h
    const settings = clinicSettings.get(apt.clinic_id)
    if (!settings?.reminder_72h) continue

    const patient = apt.patients as unknown as { name: string; phone: string } | null
    const doctor = apt.doctors as unknown as { name: string; specialty: string | null } | null
    const clinic = apt.clinics as unknown as { name: string; address: string; city: string | null } | null

    if (!patient || !doctor || !clinic) continue

    const dateText = formatDateForPatient(apt.starts_at)
    const timeText = formatTimeForPatient(apt.starts_at)

    // Prefijo Dr./Dra. según especialidad (heurística simple)
    const doctorPrefix = doctor.specialty?.toLowerCase().includes('ginec') ||
      doctor.specialty?.toLowerCase().includes('obstet') ||
      doctor.specialty?.toLowerCase().includes('pediatr')
      ? 'Dra.' : 'Dr.'

    const address = clinic.city
      ? `${clinic.address}, ${clinic.city}`
      : clinic.address

    const message =
      `Hola ${patient.name} 👋 Te recordamos que tienes cita con ${doctorPrefix} ${doctor.name} el ${dateText} a las ${timeText}.\n\n` +
      `📍 ${address}\n\n` +
      `Si necesitas cambiar tu cita responde CAMBIAR y te ayudamos de inmediato.`

    const whatsappNumber = patient.phone.replace('+', '')
    const creds = await getClinicCreds(apt.clinic_id)
    if (!creds) { console.warn(`[Cron:72h] Clínica sin WhatsApp: ${apt.clinic_id}`); continue }
    const result = await sendWhatsAppMessage(whatsappNumber, message, creds)

    if (result) {
      sent++
      await supabaseAdmin
        .from('appointments')
        .update({ reminder_72h_sent: true })
        .eq('id', apt.id)

      await supabaseAdmin.from('reminders').insert({
        appointment_id: apt.id,
        type: '72h',
        scheduled_for: apt.starts_at,
        sent_at: new Date().toISOString(),
        status: 'sent',
      })

      console.log(`[Cron:72h] Recordatorio enviado a ${patient.name}`)
    } else {
      failed++
      console.error(`[Cron:72h] Falló envío a ${patient.name}`)
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[Cron:72h] Enviados: ${sent}, fallidos: ${failed}`)
  }

  return { sent, failed }
}

// ============================================================
// IMPROVEMENT 3 + existing: Recordatorio 24h mejorado
// Incluye instrucciones de preparación y documentos si aplica
// Siempre incluye opción de cancelar/reagendar
// ============================================================
async function send24hReminders(
  clinicSettings: Map<string, NotificationSettings>
): Promise<{ sent: number; failed: number }> {
  const now = new Date()
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000)
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, clinic_id, patient_id, doctor_id, consultation_type_id,
      patients(name, phone),
      doctors(name),
      clinics(name, address),
      consultation_types(preparation_instructions, requires_documents, required_documents_description)
    `)
    .in('status', ['confirmed', 'rescheduled'])
    .eq('reminder_24h_sent', false)
    .gte('starts_at', in23h.toISOString())
    .lte('starts_at', in25h.toISOString())

  if (error) {
    console.error('[Cron:24h] Error consultando citas:', error)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const apt of appointments ?? []) {
    const settings = clinicSettings.get(apt.clinic_id)
    if (!settings?.reminder_24h) continue

    const patient = apt.patients as unknown as { name: string; phone: string } | null
    const doctor = apt.doctors as unknown as { name: string } | null
    const clinic = apt.clinics as unknown as { name: string; address: string } | null
    const ctData = apt.consultation_types as unknown as {
      preparation_instructions: string | null
      requires_documents: boolean
      required_documents_description: string | null
    } | null

    if (!patient || !doctor || !clinic) continue

    const dateText = formatDateForPatient(apt.starts_at)
    const timeText = formatTimeForPatient(apt.starts_at)

    // Mensaje base
    let message =
      `Hola ${patient.name} 👋\n\n` +
      `Te recordamos tu cita mañana:\n` +
      `📅 ${dateText}\n` +
      `🕐 ${timeText}\n` +
      `👨‍⚕️ ${doctor.name}\n` +
      `📍 ${clinic.address}`

    // IMPROVEMENT 3: Agregar instrucciones de preparación si existen
    if (ctData?.preparation_instructions) {
      message += `\n\n⚠️ Recuerda: ${ctData.preparation_instructions}`
    }

    // IMPROVEMENT 3: Agregar documentos requeridos si aplica
    if (ctData?.requires_documents && ctData?.required_documents_description) {
      message += `\n\n📄 Recuerda traer: ${ctData.required_documents_description}`
    }

    // Confirmación explícita con opciones claras
    message += `\n\n¿Confirmas tu cita? Responde:\n✅ SÍ para confirmar\n❌ NO para cancelar\n📅 CAMBIAR para reagendar`

    const whatsappNumber = patient.phone.replace('+', '')
    const creds24 = await getClinicCreds(apt.clinic_id)
    if (!creds24) { console.warn(`[Cron:24h] Clínica sin WhatsApp: ${apt.clinic_id}`); continue }
    const result = await sendWhatsAppMessage(whatsappNumber, message, creds24)

    if (result) {
      sent++
      await supabaseAdmin
        .from('appointments')
        .update({
          reminder_24h_sent: true,
          reminder_confirmed: null,
        })
        .eq('id', apt.id)

      await supabaseAdmin.from('reminders').insert({
        appointment_id: apt.id,
        type: '24h',
        scheduled_for: apt.starts_at,
        sent_at: new Date().toISOString(),
        status: 'sent',
      })

      console.log(`[Cron:24h] Recordatorio enviado a ${patient.name}`)
    } else {
      failed++
      console.error(`[Cron:24h] Falló envío a ${patient.name}`)
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[Cron:24h] Enviados: ${sent}, fallidos: ${failed}`)
  }

  return { sent, failed }
}

// ============================================================
// IMPROVEMENT 2: Recordatorio 2h — solo alto riesgo
// Solo envía a:
//   - Pacientes con no_show_count >= 1
//   - Citas agendadas con >7 días de anticipación
// Excluye:
//   - Pacientes con asistencia perfecta (no_show_count=0 AND total_appointments>=3)
// ============================================================
async function send2hReminders(
  clinicSettings: Map<string, NotificationSettings>
): Promise<{ sent: number; failed: number }> {
  const now = new Date()
  const in1h30m = new Date(now.getTime() + 1.5 * 60 * 60 * 1000)
  const in2h30m = new Date(now.getTime() + 2.5 * 60 * 60 * 1000)

  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, created_at, clinic_id, patient_id, doctor_id,
      patients(name, phone, no_show_count, total_appointments),
      doctors(name),
      clinics(name)
    `)
    .in('status', ['confirmed', 'rescheduled'])
    .eq('reminder_2h_sent', false)
    .gte('starts_at', in1h30m.toISOString())
    .lte('starts_at', in2h30m.toISOString())

  if (error) {
    console.error('[Cron:2h] Error consultando citas:', error)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0
  let skippedLowRisk = 0

  for (const apt of appointments ?? []) {
    const settings = clinicSettings.get(apt.clinic_id)
    if (!settings?.reminder_2h) continue

    const patient = apt.patients as unknown as {
      name: string
      phone: string
      no_show_count: number
      total_appointments: number
    } | null
    const doctor = apt.doctors as unknown as { name: string } | null

    if (!patient || !doctor) continue

    // --- Filtro de alto riesgo ---
    const noShowCount = patient.no_show_count ?? 0
    const totalApts = patient.total_appointments ?? 0

    // Excluir pacientes con asistencia perfecta (>=3 citas, 0 no-shows)
    if (noShowCount === 0 && totalApts >= 3) {
      skippedLowRisk++
      // Marcar como enviado para no volver a evaluar
      await supabaseAdmin
        .from('appointments')
        .update({ reminder_2h_sent: true })
        .eq('id', apt.id)
      continue
    }

    // Calcular si la cita fue agendada con >7 días de anticipación
    const bookedAt = new Date(apt.created_at)
    const startsAt = new Date(apt.starts_at)
    const daysBetween = (startsAt.getTime() - bookedAt.getTime()) / (24 * 60 * 60 * 1000)
    const bookedFarInAdvance = daysBetween > 7

    // Solo enviar si: tiene historial de no-show O agendó con mucha anticipación
    const hasNoShowHistory = noShowCount >= 1
    if (!hasNoShowHistory && !bookedFarInAdvance) {
      skippedLowRisk++
      await supabaseAdmin
        .from('appointments')
        .update({ reminder_2h_sent: true })
        .eq('id', apt.id)
      continue
    }

    const timeText = formatTimeForPatient(apt.starts_at)

    const message =
      `Hola ${patient.name}, te esperamos hoy a las ${timeText} con ${doctor.name}. ¡Hasta pronto! 🙂`

    const whatsappNumber = patient.phone.replace('+', '')
    const creds2h = await getClinicCreds(apt.clinic_id)
    if (!creds2h) { console.warn(`[Cron:2h] Clínica sin WhatsApp: ${apt.clinic_id}`); continue }
    const result = await sendWhatsAppMessage(whatsappNumber, message, creds2h)

    if (result) {
      sent++
      await supabaseAdmin
        .from('appointments')
        .update({ reminder_2h_sent: true })
        .eq('id', apt.id)

      await supabaseAdmin.from('reminders').insert({
        appointment_id: apt.id,
        type: '2h',
        scheduled_for: apt.starts_at,
        sent_at: new Date().toISOString(),
        status: 'sent',
      })

      console.log(`[Cron:2h] Recordatorio enviado a ${patient.name} (riesgo: noshow=${noShowCount}, anticipación=${Math.round(daysBetween)}d)`)
    } else {
      failed++
      console.error(`[Cron:2h] Falló envío a ${patient.name}`)
    }
  }

  if (sent > 0 || failed > 0 || skippedLowRisk > 0) {
    console.log(`[Cron:2h] Enviados: ${sent}, fallidos: ${failed}, bajo riesgo omitidos: ${skippedLowRisk}`)
  }

  return { sent, failed }
}

// ============================================================
// Marcar citas sin confirmación como "no confirmadas" después de 12h
// ============================================================
async function markUnconfirmedAppointments(): Promise<void> {
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000)

  const { data: unconfirmed } = await supabaseAdmin
    .from('appointments')
    .select('id, patient_id, clinic_id')
    .eq('reminder_24h_sent', true)
    .is('reminder_confirmed', null)
    .in('status', ['confirmed', 'rescheduled'])
    .lte('updated_at', twelveHoursAgo.toISOString())

  for (const apt of unconfirmed ?? []) {
    await supabaseAdmin
      .from('appointments')
      .update({ reminder_confirmed: false })
      .eq('id', apt.id)

    await supabaseAdmin
      .from('reminders')
      .update({ response: 'no_response' })
      .eq('appointment_id', apt.id)
      .eq('type', '24h')

    await calculateNoShowProbability(apt.patient_id, apt.clinic_id)
  }

  if ((unconfirmed?.length ?? 0) > 0) {
    console.log(`[Cron:Reminders] ${unconfirmed?.length} citas marcadas como no confirmadas`)

    const affectedClinicIds = new Set((unconfirmed ?? []).map(a => a.clinic_id))
    for (const cId of affectedClinicIds) {
      try { syncClinicSheet(cId, ['appointments', 'patients', 'finances', 'noshow_stats']) } catch { /* no crítico */ }
    }
  }
}

// ============================================================
// Links de videollamada para citas virtuales (~30 min antes)
// ============================================================
async function sendVirtualLinks(): Promise<{ sent: number; failed: number }> {
  const now = new Date()
  const in25m = new Date(now.getTime() + 25 * 60 * 1000)
  const in65m = new Date(now.getTime() + 65 * 60 * 1000)

  const { data: virtualAppts, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, virtual_link, clinic_id, doctor_id,
      patients(name, phone),
      doctors(name),
      clinics(virtual_config)
    `)
    .eq('modality', 'virtual')
    .in('status', ['confirmed', 'rescheduled'])
    .not('virtual_link', 'is', null)
    .is('virtual_link_sent_at', null)
    .gte('starts_at', in25m.toISOString())
    .lte('starts_at', in65m.toISOString())

  if (error) {
    console.error('[Cron:VirtualLinks] Error:', error)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const apt of virtualAppts ?? []) {
    const patient = apt.patients as unknown as { name: string; phone: string } | null
    const doctor = apt.doctors as unknown as { name: string } | null
    const clinicData = apt.clinics as unknown as { virtual_config: Record<string, unknown> | null } | null

    if (!patient || !doctor) continue

    const timeText = formatTimeForPatient(apt.starts_at)
    const instructions = (clinicData?.virtual_config as { instructions?: string } | null)?.instructions

    let message =
      `Tu cita virtual con ${doctor.name} comienza en 30 minutos.\n` +
      `🕐 ${timeText}\n` +
      `📲 Únete aquí: ${apt.virtual_link}`

    if (instructions) {
      message += `\n\n${instructions}`
    }

    message += '\n\nSi tienes problemas técnicos escríbenos de inmediato.'

    const whatsappNumber = patient.phone.replace('+', '')
    const credsVirtual = await getClinicCreds(apt.clinic_id)
    if (!credsVirtual) continue
    const result = await sendWhatsAppMessage(whatsappNumber, message, credsVirtual)

    if (result) {
      sent++
      await supabaseAdmin
        .from('appointments')
        .update({ virtual_link_sent_at: new Date().toISOString() })
        .eq('id', apt.id)
      console.log(`[Cron:VirtualLinks] Link enviado a ${patient.name}`)
    } else {
      failed++
      console.error(`[Cron:VirtualLinks] Falló envío a ${patient.name}`)
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[Cron:VirtualLinks] Enviados: ${sent}, fallidos: ${failed}`)
  }

  return { sent, failed }
}

// ============================================================
// Recordatorios de documentos pendientes (48h antes)
// ============================================================
async function sendDocumentReminders(): Promise<{ sent: number; failed: number }> {
  const now = new Date()
  const in47h = new Date(now.getTime() + 47 * 60 * 60 * 1000)
  const in49h = new Date(now.getTime() + 49 * 60 * 60 * 1000)

  const { data: pendingAppts, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, clinic_id,
      patients(name, phone),
      doctors(name),
      consultation_types(required_documents_description)
    `)
    .eq('documents_requested', true)
    .eq('documents_received', false)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', in47h.toISOString())
    .lte('starts_at', in49h.toISOString())

  if (error) {
    console.error('[Cron:DocReminders] Error:', error)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const apt of pendingAppts ?? []) {
    const patient = apt.patients as unknown as { name: string; phone: string } | null
    const doctor = apt.doctors as unknown as { name: string } | null
    const ctData = apt.consultation_types as unknown as { required_documents_description: string | null } | null

    if (!patient || !doctor) continue

    const dateText = formatDateForPatient(apt.starts_at)
    const docsDescription = ctData?.required_documents_description
      ? ` (${ctData.required_documents_description})`
      : ''

    const message =
      `📄 Hola ${patient.name}, te recordamos que tu cita del ${dateText} con ${doctor.name} ` +
      `requiere documentos previos${docsDescription}.\n\n` +
      `Puedes enviarlos por este chat (foto o archivo). ¡Gracias!`

    const whatsappNumber = patient.phone.replace('+', '')
    const credsDocs = await getClinicCreds(apt.clinic_id)
    if (!credsDocs) continue
    const result = await sendWhatsAppMessage(whatsappNumber, message, credsDocs)

    if (result) {
      sent++
      await supabaseAdmin
        .from('appointments')
        .update({ documents_notes: 'Recordatorio 48h enviado' })
        .eq('id', apt.id)
      console.log(`[Cron:DocReminders] Recordatorio enviado a ${patient.name}`)
    } else {
      failed++
      console.error(`[Cron:DocReminders] Falló envío a ${patient.name}`)
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[Cron:DocReminders] Enviados: ${sent}, fallidos: ${failed}`)
  }

  return { sent, failed }
}

// ============================================================
// Auto-timeout: reabrir conversaciones escaladas >24h sin respuesta staff
// ============================================================
async function autoTimeoutEscalatedConversations(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: stale } = await supabaseAdmin
    .from('conversations')
    .select('id, clinic_id, whatsapp_phone, patient_id')
    .eq('status', 'escalated')
    .lt('escalated_at', cutoff)

  if (!stale || stale.length === 0) return 0

  let count = 0
  for (const conv of stale) {
    // Verificar que NO hubo respuesta staff en las últimas 24h
    const { count: staffMsgCount } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .eq('role', 'staff')
      .gte('created_at', cutoff)

    if ((staffMsgCount ?? 0) > 0) continue

    // Reabrir conversación
    await supabaseAdmin
      .from('conversations')
      .update({ status: 'active', escalated_to: null, escalated_at: null })
      .eq('id', conv.id)

    // Enviar mensaje al paciente
    const phone = conv.whatsapp_phone.replace('+', '')
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_phone_id, whatsapp_access_token')
      .eq('id', conv.clinic_id)
      .maybeSingle()
    const creds = clinic?.whatsapp_phone_id && clinic?.whatsapp_access_token
      ? { phoneNumberId: clinic.whatsapp_phone_id, accessToken: clinic.whatsapp_access_token }
      : null

    const msg = 'Hola, retomamos tu conversación. ¿En qué podemos ayudarte?'
    await sendWhatsAppMessage(phone, msg, creds)

    await supabaseAdmin.from('messages').insert({
      conversation_id: conv.id,
      role: 'agent',
      content: msg,
      message_type: 'text',
    })

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: conv.clinic_id,
      action: 'escalation_auto_timeout',
      actor_type: 'system',
      target_type: 'conversation',
      target_id: conv.id,
      details: { timeout_hours: 24 },
    })

    count++
    console.log(`[Cron:EscTimeout] Conversación ${conv.id} reabierta tras 24h sin respuesta staff`)
  }

  return count
}
