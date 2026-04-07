// ============================================================
// CRON JOB: Reactivación de pacientes inactivos
// Se ejecuta cada lunes a las 10am Bogotá (15:00 UTC)
//
// Usa visit_frequency_days del paciente:
// - Si tiene frecuencia: reactivar si última visita > frecuencia × 2
// - Si no tiene frecuencia (nuevo/1 cita): usar default clínica (90d)
// Solo envía si no se ha reactivado en los últimos 30 días.
//
// Solo envía si la clínica tiene automations.reactivacion.enabled
//
// Schedule: "0 15 * * 1"
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { checkRateLimit, RATE_LIMITS, verifyCronSecret } from '@/lib/rate-limit'
import { formatFrequency } from '@/app/actions/reactivation'
import type { WhatsAppConfig } from '@/types/database'
import { format } from 'date-fns'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const rateLimit = checkRateLimit('cron:reactivacion', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  console.log('[Cron:Reactivacion] Iniciando reactivación de pacientes inactivos...')

  try {
    const { data: clinics } = await supabaseAdmin
      .from('clinics')
      .select('id, name, whatsapp_config')
      .in('subscription_status', ['trial', 'active'])

    let totalSent = 0
    let totalFailed = 0

    for (const clinic of clinics ?? []) {
      const config = clinic.whatsapp_config as WhatsAppConfig | null
      if (!config?.automations?.reactivacion?.enabled) continue

      const defaultDays = config.automations.reactivacion.days_inactive ?? 90
      const result = await processClinicReactivation(clinic.id, defaultDays)
      totalSent += result.sent
      totalFailed += result.failed
    }

    console.log(`[Cron:Reactivacion] Completado — enviados: ${totalSent}, fallidos: ${totalFailed}`)
    return NextResponse.json({ status: 'ok', sent: totalSent, failed: totalFailed })
  } catch (error) {
    console.error('[Cron:Reactivacion] Error general:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

async function processClinicReactivation(
  clinicId: string,
  defaultDaysInactive: number
): Promise<{ sent: number; failed: number }> {
  const today = format(new Date(), 'yyyy-MM-dd')
  const thirtyDaysAgo = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')

  // Pacientes con >=2 citas, sin reactivación reciente
  const { data: candidates } = await supabaseAdmin
    .from('patients')
    .select('id, name, phone, last_reactivation_sent, visit_frequency_days')
    .eq('clinic_id', clinicId)
    .gte('total_appointments', 1)
    .or(`last_reactivation_sent.is.null,last_reactivation_sent.lt.${thirtyDaysAgo}`)

  let sent = 0
  let failed = 0

  for (const patient of candidates ?? []) {
    // Obtener última cita completada
    const { data: lastAppointment } = await supabaseAdmin
      .from('appointments')
      .select('starts_at')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patient.id)
      .in('status', ['completed'])
      .order('starts_at', { ascending: false })
      .limit(1)
      .single()

    if (!lastAppointment) continue

    const daysSinceLastVisit = Math.floor(
      (Date.now() - new Date(lastAppointment.starts_at).getTime()) / (1000 * 60 * 60 * 24)
    )

    // Determinar umbral de reactivación
    const threshold = patient.visit_frequency_days
      ? patient.visit_frequency_days * 2
      : defaultDaysInactive

    // Si no ha pasado suficiente tiempo, no reactivar
    if (daysSinceLastVisit < threshold) continue

    // Construir mensaje personalizado
    let message: string
    if (patient.visit_frequency_days) {
      const freqText = await formatFrequency(patient.visit_frequency_days)
      const sinceText = daysSinceLastVisit >= 30
        ? `${Math.round(daysSinceLastVisit / 30)} mes${Math.round(daysSinceLastVisit / 30) !== 1 ? 'es' : ''}`
        : `${daysSinceLastVisit} días`

      message =
        `Hola ${patient.name} 😊\n\n` +
        `Solías visitarnos ${freqText} y hace ${sinceText} que no te vemos.\n\n` +
        `¿Todo bien? Con gusto te agendamos tu próxima visita cuando quieras.\n\n` +
        `Responde *Sí* y te ayudamos de inmediato.`
    } else {
      message =
        `Hola ${patient.name} 😊\n\n` +
        `Han pasado unos meses desde tu última visita y queremos saber cómo estás.\n\n` +
        `Si necesitas una consulta o chequeo, con gusto te agendamos. ` +
        `¿Te gustaría reservar una cita?\n\n` +
        `Responde *Sí* y te ayudamos de inmediato.`
    }

    const whatsappNumber = patient.phone.replace('+', '')
    const result = await sendWhatsAppMessage(whatsappNumber, message)

    if (result) {
      sent++
      await supabaseAdmin
        .from('patients')
        .update({ last_reactivation_sent: today })
        .eq('id', patient.id)

      console.log(`[Cron:Reactivacion] Mensaje enviado a ${patient.name} (freq: ${patient.visit_frequency_days ?? 'default'}d, threshold: ${threshold}d)`)
    } else {
      failed++
      console.error(`[Cron:Reactivacion] Falló envío a ${patient.name}`)
    }
  }

  return { sent, failed }
}
