// ============================================================
// CRON JOB: Enviar recordatorios 24h antes de cada cita
// Se ejecuta cada hora (configurado en vercel.json)
// Busca citas que están a ~24h y envía recordatorio por WhatsApp
//
// Schedule: "0 * * * *" (cada hora en punto)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { formatDateForPatient, formatTimeForPatient } from '@/lib/utils/dates'
import { calculateNoShowProbability } from '@/lib/utils/noshow'
import { syncClinicSheet } from '@/lib/google-sheets'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

// Máximo tiempo de ejecución
export const maxDuration = 30

export async function GET(request: NextRequest) {
  // Verificar que la petición viene de Vercel Cron (seguridad)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[Cron:Reminders] Acceso no autorizado')
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  // Rate limit: 5 req/min
  const rateLimit = checkRateLimit('cron:send-reminders', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  console.log('[Cron:Reminders] Iniciando envío de recordatorios...')

  try {
    // Buscar citas que están a ~24h (entre 23h y 25h desde ahora)
    const now = new Date()
    const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000)
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000)

    const { data: appointments, error } = await supabaseAdmin
      .from('appointments')
      .select(`
        id, starts_at, clinic_id, patient_id, doctor_id,
        patients(name, phone),
        doctors(name),
        clinics(name, address)
      `)
      .in('status', ['confirmed', 'rescheduled'])
      .eq('reminder_24h_sent', false)
      .gte('starts_at', in23h.toISOString())
      .lte('starts_at', in25h.toISOString())

    if (error) {
      console.error('[Cron:Reminders] Error consultando citas:', error)
      return NextResponse.json({ error: 'Error DB' }, { status: 500 })
    }

    console.log(`[Cron:Reminders] ${appointments?.length ?? 0} citas encontradas para recordatorio`)

    let sent = 0
    let failed = 0

    for (const apt of appointments ?? []) {
      const patient = apt.patients as unknown as { name: string; phone: string } | null
      const doctor = apt.doctors as unknown as { name: string } | null
      const clinic = apt.clinics as unknown as { name: string; address: string } | null

      if (!patient || !doctor || !clinic) {
        console.warn(`[Cron:Reminders] Datos incompletos para cita ${apt.id}`)
        continue
      }

      // Construir mensaje de recordatorio
      const dateText = formatDateForPatient(apt.starts_at)
      const timeText = formatTimeForPatient(apt.starts_at)

      const reminderMessage =
        `Hola ${patient.name} 👋\n\n` +
        `Te recordamos tu cita mañana:\n` +
        `📅 ${dateText}\n` +
        `🕐 ${timeText}\n` +
        `👨‍⚕️ ${doctor.name}\n` +
        `📍 ${clinic.address}\n\n` +
        `¿Confirmas tu asistencia?\n` +
        `Responde "Sí" para confirmar o "No" si no puedes asistir.`

      // Enviar por WhatsApp
      const whatsappNumber = patient.phone.replace('+', '')
      const result = await sendWhatsAppMessage(whatsappNumber, reminderMessage)

      if (result) {
        sent++

        // Marcar recordatorio como enviado
        await supabaseAdmin
          .from('appointments')
          .update({
            reminder_24h_sent: true,
            reminder_confirmed: null, // Pendiente de respuesta
          })
          .eq('id', apt.id)

        // Crear registro de recordatorio
        await supabaseAdmin
          .from('reminders')
          .insert({
            appointment_id: apt.id,
            type: '24h',
            scheduled_for: apt.starts_at,
            sent_at: new Date().toISOString(),
            status: 'sent',
          })

        console.log(`[Cron:Reminders] Recordatorio enviado a ${patient.name}`)
      } else {
        failed++
        console.error(`[Cron:Reminders] Falló envío a ${patient.name}`)
      }
    }

    // Marcar citas sin confirmación como "no confirmadas" después de 12h
    await markUnconfirmedAppointments()

    console.log(`[Cron:Reminders] Completado — enviados: ${sent}, fallidos: ${failed}`)

    return NextResponse.json({
      status: 'ok',
      sent,
      failed,
      total: appointments?.length ?? 0,
    })
  } catch (error) {
    console.error('[Cron:Reminders] Error general:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

/**
 * Marca como "no confirmadas" las citas que recibieron recordatorio
 * hace más de 12h y no respondieron
 */
async function markUnconfirmedAppointments(): Promise<void> {
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000)

  // Buscar citas con recordatorio enviado pero sin confirmación
  const { data: unconfirmed } = await supabaseAdmin
    .from('appointments')
    .select('id, patient_id, clinic_id')
    .eq('reminder_24h_sent', true)
    .is('reminder_confirmed', null)
    .in('status', ['confirmed', 'rescheduled'])
    .lte('updated_at', twelveHoursAgo.toISOString())

  for (const apt of unconfirmed ?? []) {
    // Marcar como no confirmada
    await supabaseAdmin
      .from('appointments')
      .update({ reminder_confirmed: false })
      .eq('id', apt.id)

    // Actualizar recordatorio
    await supabaseAdmin
      .from('reminders')
      .update({ response: 'no_response' })
      .eq('appointment_id', apt.id)
      .eq('type', '24h')

    // Recalcular probabilidad de no-show (incluye el +30% por no confirmar)
    await calculateNoShowProbability(apt.patient_id, apt.clinic_id)
  }

  if ((unconfirmed?.length ?? 0) > 0) {
    console.log(`[Cron:Reminders] ${unconfirmed?.length} citas marcadas como no confirmadas`)

    // Sync Google Sheets para clínicas afectadas
    const affectedClinicIds = new Set((unconfirmed ?? []).map(a => a.clinic_id))
    for (const cId of affectedClinicIds) {
      try { syncClinicSheet(cId, ['appointments', 'patients', 'finances', 'noshow_stats']) } catch { /* no crítico */ }
    }
  }
}
