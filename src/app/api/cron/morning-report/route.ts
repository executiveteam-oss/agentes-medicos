// ============================================================
// CRON JOB: Reporte matutino para el doctor (6am Colombia)
// Se ejecuta a las 11:00 UTC = 6:00 AM Colombia
//
// Envía por WhatsApp al doctor:
// - Resumen de citas del día
// - Pacientes en riesgo de no-show (probabilidad > 40%)
// - Recomendación de overbooking si aplica
//
// Schedule: "0 11 * * *" (6am Colombia)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, getClinicCreds } from '@/lib/whatsapp/client'
import { sendEmail } from '@/lib/email/client'
import { formatTimeForPatient, nowColombia } from '@/lib/utils/dates'
import { calculateDailyNoShowRisk, calculateNoShowProbability } from '@/lib/utils/noshow'
import { checkRateLimit, RATE_LIMITS, verifyCronSecret } from '@/lib/rate-limit'
import { format } from 'date-fns'

// Máximo tiempo de ejecución
export const maxDuration = 30

export async function GET(request: NextRequest) {
  // Verificar autorización (timing-safe)
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  // Rate limit: 5 req/min
  const rateLimit = checkRateLimit('cron:morning-report', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  console.log('[Cron:MorningReport] Generando reporte matutino...')

  try {
    // Obtener todas las clínicas activas
    const { data: clinics } = await supabaseAdmin
      .from('clinics')
      .select('id, name')
      .in('subscription_status', ['trial', 'active'])

    let reportsSent = 0

    for (const clinic of clinics ?? []) {
      await generateAndSendReport(clinic.id, clinic.name)
      reportsSent++
    }

    console.log(`[Cron:MorningReport] Completado — ${reportsSent} reportes enviados`)
    return NextResponse.json({ status: 'ok', reportsSent })
  } catch (error) {
    console.error('[Cron:MorningReport] Error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

async function generateAndSendReport(clinicId: string, clinicName: string): Promise<void> {
  // Obtener doctor principal
  const { data: doctor } = await supabaseAdmin
    .from('doctors')
    .select('id, name, phone, email')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (!doctor || !doctor.phone) {
    console.warn(`[Cron:MorningReport] Doctor sin teléfono en clínica ${clinicId}`)
    return
  }

  // Fecha de hoy en Colombia
  const today = format(nowColombia(), 'yyyy-MM-dd')

  // Recalcular probabilidad de no-show para pacientes con citas hoy
  const { data: todayAppointments } = await supabaseAdmin
    .from('appointments')
    .select('patient_id')
    .eq('clinic_id', clinicId)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', `${today}T00:00:00-05:00`)
    .lte('starts_at', `${today}T23:59:59-05:00`)

  for (const apt of todayAppointments ?? []) {
    await calculateNoShowProbability(apt.patient_id, clinicId)
  }

  // Calcular riesgo del día
  const dailyRisk = await calculateDailyNoShowRisk(clinicId, today)

  if (dailyRisk.totalAppointments === 0) {
    // No hay citas hoy, enviar mensaje corto
    const noAptsMessage = `☀️ Buenos días, ${doctor.name}.\n\nNo tienes citas agendadas para hoy. ¡Buen día!`
    const whatsappNumber = doctor.phone.replace('+', '')
    const creds = await getClinicCreds(clinicId)
    if (!creds) { console.warn(`[Cron:MorningReport] Sin WhatsApp: ${clinicId}`); return }
    await sendWhatsAppMessage(whatsappNumber, noAptsMessage, creds)
    return
  }

  // Construir el reporte
  let report = `☀️ Buenos días, ${doctor.name}\n`
  report += `📊 Reporte del día — ${clinicName}\n\n`
  report += `📋 Tienes ${dailyRisk.totalAppointments} cita${dailyRisk.totalAppointments > 1 ? 's' : ''} hoy:\n\n`

  // Lista de citas con semáforo
  for (const patient of dailyRisk.patients) {
    const time = formatTimeForPatient(patient.startsAt)
    let indicator: string

    if (patient.reminderConfirmed === true) {
      indicator = '🟢' // Confirmó
    } else if (patient.probability > 40) {
      indicator = '🔴' // Alto riesgo
    } else {
      indicator = '🟡' // No ha respondido
    }

    report += `${indicator} ${time} — ${patient.name}`
    if (patient.probability > 40) {
      report += ` ⚠️ ${patient.probability}% riesgo no-show`
    }
    report += '\n'
  }

  // Pacientes en riesgo
  const atRisk = dailyRisk.patients.filter((p) => p.probability > 40)
  if (atRisk.length > 0) {
    report += `\n⚠️ ${atRisk.length} paciente${atRisk.length > 1 ? 's' : ''} con riesgo alto de no-show\n`
  }

  // Documentos pendientes
  const { count: pendingDocs } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('documents_requested', true)
    .eq('documents_received', false)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('starts_at', `${today}T00:00:00-05:00`)
    .lte('starts_at', `${today}T23:59:59-05:00`)

  if (pendingDocs && pendingDocs > 0) {
    report += `\n📄 ${pendingDocs} cita${pendingDocs > 1 ? 's' : ''} con documentos pendientes\n`
  }

  // Solicitudes manuales pendientes
  const { count: pendingManual } = await supabaseAdmin
    .from('waitlist')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('status', 'waiting')
    .eq('source', 'whatsapp')

  if (pendingManual && pendingManual > 0) {
    report += `\n📋 ${pendingManual} solicitud${pendingManual > 1 ? 'es' : ''} de cita manual pendiente${pendingManual > 1 ? 's' : ''}\n`
  }

  // Recomendación de overbooking
  if (dailyRisk.recommendOverbooking) {
    report += `\n📈 Basado en el historial, se esperan ~${dailyRisk.expectedNoShows} no-show${dailyRisk.expectedNoShows > 1 ? 's' : ''} hoy.`
    report += ` Recomendamos abrir 1 slot adicional.`
    report += `\n¿Deseas abrirlo? Responde "Abrir slot" para confirmar.`
  }

  // Leyenda
  report += `\n\n🟢 Confirmó  🟡 Pendiente  🔴 Alto riesgo`

  // Enviar al doctor por WhatsApp
  const whatsappNumber = doctor.phone.replace('+', '')
  const credsReport = await getClinicCreds(clinicId)
  if (!credsReport) { console.warn(`[Cron:MorningReport] Sin WhatsApp: ${clinicId}`); return }
  await sendWhatsAppMessage(whatsappNumber, report, credsReport)

  // También enviar por email si el doctor tiene email
  if (doctor.email) {
    const htmlReport = report
      .replace(/\n/g, '<br>')
      .replace(/🟢/g, '<span style="color:#16a34a">●</span>')
      .replace(/🟡/g, '<span style="color:#eab308">●</span>')
      .replace(/🔴/g, '<span style="color:#dc2626">●</span>')

    await sendEmail({
      to: doctor.email,
      subject: `Reporte del día — ${clinicName}`,
      html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">${htmlReport}</div>`,
    })
  }

  console.log(`[Cron:MorningReport] Reporte enviado a ${doctor.name}`)
}
