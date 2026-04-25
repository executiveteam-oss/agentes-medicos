// ============================================================
// CRON JOB: Reporte semanal al admin por WhatsApp
// Schedule: "0 13 * * 1" (lunes 8am Colombia = 1pm UTC)
//
// Para cada clínica con >=10 citas históricas, calcula
// métricas de la semana pasada y envía resumen por WhatsApp.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { formatCOP } from '@/lib/utils/dates'
import { checkRateLimit, RATE_LIMITS, verifyCronSecret } from '@/lib/rate-limit'
import type { NotificationSettings } from '@/types/database'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const rateLimit = checkRateLimit('cron:weekly-report', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  console.log('[Cron:WeeklyReport] Iniciando reporte semanal...')

  try {
    // Clínicas activas con al menos 10 citas totales
    const { data: clinics } = await supabaseAdmin
      .from('clinics')
      .select('id, name, phone, escalation_contact_phone, consultation_price, notification_settings, whatsapp_phone_id, whatsapp_access_token')
      .in('subscription_status', ['trial', 'active'])

    let sentCount = 0
    let skipped = 0

    for (const clinic of clinics ?? []) {
      // Verificar que el reporte semanal esté habilitado
      const settings: NotificationSettings = {
        reminder_72h: false,
        reminder_24h: true,
        reminder_2h: false,
        morning_report: true,
        morning_report_hour: '06:00',
        noshow_alert: false,
        noshow_alert_threshold: 30,
        overdue_billing_alert: false,
        overdue_billing_days: 30,
        weekly_report: true,
        ...(clinic.notification_settings as Partial<NotificationSettings> | null),
      }

      if (!settings.weekly_report) {
        skipped++
        continue
      }

      // Verificar mínimo de citas
      const { count: totalAptsCount } = await supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinic.id)
        .in('status', ['completed', 'no_show', 'confirmed', 'rescheduled'])

      if ((totalAptsCount ?? 0) < 10) {
        skipped++
        continue
      }

      // Calcular rango semana pasada (lunes a domingo)
      const now = new Date()
      const dayOfWeek = now.getUTCDay() // 0=dom, 1=lun
      // Hoy es lunes UTC. Semana pasada: lunes pasado a domingo
      const lastMonday = new Date(now)
      lastMonday.setUTCDate(now.getUTCDate() - 7)
      lastMonday.setUTCHours(5, 0, 0, 0) // 00:00 COT = 05:00 UTC
      const lastSunday = new Date(lastMonday)
      lastSunday.setUTCDate(lastMonday.getUTCDate() + 7) // siguiente lunes 00:00 COT

      const weekStart = lastMonday.toISOString()
      const weekEnd = lastSunday.toISOString()

      // Métricas de la semana
      const [completedRes, scheduledRes, noShowRes, newPatientsRes] = await Promise.all([
        supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic.id)
          .eq('status', 'completed')
          .gte('starts_at', weekStart)
          .lt('starts_at', weekEnd),
        supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic.id)
          .in('status', ['completed', 'no_show', 'confirmed', 'rescheduled', 'cancelled'])
          .gte('starts_at', weekStart)
          .lt('starts_at', weekEnd),
        supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic.id)
          .eq('status', 'no_show')
          .gte('starts_at', weekStart)
          .lt('starts_at', weekEnd),
        supabaseAdmin
          .from('patients')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic.id)
          .gte('created_at', weekStart)
          .lt('created_at', weekEnd),
      ])

      const completed = completedRes.count ?? 0
      const scheduled = scheduledRes.count ?? 0
      const noShows = noShowRes.count ?? 0
      const newPatients = newPatientsRes.count ?? 0
      const price = clinic.consultation_price ?? 120000
      const revenue = completed * price

      const noShowRate = (completed + noShows) > 0
        ? Math.round((noShows / (completed + noShows)) * 100)
        : 0

      // Formatear fechas para el mensaje
      const startDate = new Date(lastMonday.getTime())
      const endDate = new Date(lastSunday.getTime() - 1) // domingo
      const fmt = (d: Date) => {
        const day = d.getUTCDate()
        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
        return `${day} ${months[d.getUTCMonth()]}`
      }

      // Construir mensaje
      let message =
        `📊 *Resumen semanal de ${clinic.name}*\n` +
        `Semana del ${fmt(startDate)} al ${fmt(endDate)}\n\n` +
        `✅ Citas atendidas: ${completed} de ${scheduled} agendadas\n` +
        `❌ No-shows: ${noShows} (${noShowRate}%)\n` +
        `💰 Ingresos: ${formatCOP(revenue)}\n` +
        `👥 Pacientes nuevos: ${newPatients}`

      // Alerta de no-shows alto
      if (noShowRate > 20) {
        message += '\n\n⚠️ Tu tasa de no-shows esta semana fue alta. Activa el recordatorio de 72h en Configuración.'
      }

      message += `\n\nVer detalles:\ndashboard.omuwan.co/dashboard`

      // Obtener teléfono del admin
      const adminPhone = (clinic.escalation_contact_phone || clinic.phone || '').trim()
      if (!adminPhone) {
        skipped++
        continue
      }

      // Credenciales WhatsApp per-clinic
      const clinicCreds = clinic.whatsapp_phone_id && clinic.whatsapp_access_token
        ? { phoneNumberId: clinic.whatsapp_phone_id, accessToken: clinic.whatsapp_access_token }
        : null

      const whatsappNumber = adminPhone.replace('+', '')
      const result = await sendWhatsAppMessage(whatsappNumber, message, clinicCreds)

      if (result) {
        sentCount++
        console.log(`[Cron:WeeklyReport] Reporte enviado para ${clinic.name}`)
      } else {
        console.error(`[Cron:WeeklyReport] Falló envío para ${clinic.name}`)
      }
    }

    console.log(`[Cron:WeeklyReport] Completado — enviados: ${sentCount}, omitidos: ${skipped}`)

    return NextResponse.json({
      status: 'ok',
      sent: sentCount,
      skipped,
    })
  } catch (error) {
    console.error('[Cron:WeeklyReport] Error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
