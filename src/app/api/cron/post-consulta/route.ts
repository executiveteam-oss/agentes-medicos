// ============================================================
// CRON JOB: Seguimiento post-consulta (NPS)
// Se ejecuta diariamente a las 9am Bogotá (14:00 UTC)
//
// Busca citas completadas hace ~24h y envía mensaje de
// seguimiento pidiendo calificación 1-10.
//
// Solo envía si la clínica tiene automations.post_consulta.enabled
//
// Schedule: "0 14 * * *"
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { checkRateLimit, RATE_LIMITS, verifyCronSecret } from '@/lib/rate-limit'
import type { WhatsAppConfig } from '@/types/database'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const rateLimit = checkRateLimit('cron:post-consulta', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  console.log('[Cron:PostConsulta] Iniciando seguimiento post-consulta...')

  try {
    // Obtener clínicas con post_consulta habilitado
    const { data: clinics } = await supabaseAdmin
      .from('clinics')
      .select('id, name, whatsapp_config')
      .in('subscription_status', ['trial', 'active'])

    let totalSent = 0
    let totalFailed = 0

    for (const clinic of clinics ?? []) {
      const config = clinic.whatsapp_config as WhatsAppConfig | null
      if (!config?.automations?.post_consulta?.enabled) continue

      const result = await processClinicFollowups(clinic.id)
      totalSent += result.sent
      totalFailed += result.failed
    }

    console.log(`[Cron:PostConsulta] Completado — enviados: ${totalSent}, fallidos: ${totalFailed}`)
    return NextResponse.json({ status: 'ok', sent: totalSent, failed: totalFailed })
  } catch (error) {
    console.error('[Cron:PostConsulta] Error general:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

async function processClinicFollowups(clinicId: string): Promise<{ sent: number; failed: number }> {
  // Buscar citas completadas hace ~24h (entre 23h y 25h atrás)
  const now = new Date()
  const ago23h = new Date(now.getTime() - 23 * 60 * 60 * 1000)
  const ago25h = new Date(now.getTime() - 25 * 60 * 60 * 1000)

  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, doctor_id,
      patients(name, phone),
      doctors(name)
    `)
    .eq('clinic_id', clinicId)
    .eq('status', 'completed')
    .eq('followup_sent', false)
    .gte('starts_at', ago25h.toISOString())
    .lte('starts_at', ago23h.toISOString())

  let sent = 0
  let failed = 0

  for (const apt of appointments ?? []) {
    const patient = apt.patients as unknown as { name: string; phone: string } | null
    const doctor = apt.doctors as unknown as { name: string } | null

    if (!patient?.phone || !doctor) continue

    const doctorTitle = doctor.name.startsWith('Dr') ? doctor.name : `Dr(a). ${doctor.name}`

    const message =
      `Hola ${patient.name} 👋\n\n` +
      `Esperamos que tu consulta con ${doctorTitle} haya ido muy bien.\n\n` +
      `¿Cómo te has sentido desde entonces?\n\n` +
      `Del 1 al 10, ¿cómo calificarías tu experiencia con nosotros? (responde solo con el número)`

    const whatsappNumber = patient.phone.replace('+', '')
    const result = await sendWhatsAppMessage(whatsappNumber, message)

    if (result) {
      sent++
      await supabaseAdmin
        .from('appointments')
        .update({ followup_sent: true })
        .eq('id', apt.id)

      console.log(`[Cron:PostConsulta] Followup enviado a ${patient.name}`)
    } else {
      failed++
      console.error(`[Cron:PostConsulta] Falló envío a ${patient.name}`)
    }
  }

  return { sent, failed }
}
