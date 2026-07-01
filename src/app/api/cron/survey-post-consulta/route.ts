// ============================================================
// CRON: Encuesta post-consulta (Feature configurable, multi-tenant)
//
// Se ejecuta cada hora. Por cada clínica con el feature activo:
//   1. Busca citas con attendance_outcome='facturado'
//      + survey_sent=false
//      + starts_at >= now - guardrail_hours
//   2. Envía template Meta pre-aprobado (nombre configurable por clínica)
//   3. Variables del template:
//      - {{1}} body → primer nombre del paciente
//      - {{2}} body → nombre de la clínica (config.clinic_display_name)
//      - {{1}} button URL → form_url configurado (Google Form, Typeform, etc.)
//   4. Marca survey_sent=true + survey_sent_at=now
//   5. Registra audit_log
//
// DOBLE GATE:
//   - feature_config.survey_post_consulta_enabled=true (maestro por clínica)
//   - whatsapp_config.automations.survey.enabled=true (toggle de la clínica)
//   - Y form_url debe estar configurado (URL válida)
//
// AISLADO del cron legacy /api/cron/post-consulta (NPS conversacional 1-10).
// Este NO comparte estado con followup_sent — usa columnas propias.
//
// Schedule: "0 * * * *" (cada hora)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getClinicCreds, sendWhatsAppTemplate } from '@/lib/whatsapp/client'
import { checkRateLimit, RATE_LIMITS, verifyCronSecret } from '@/lib/rate-limit'
import {
  SurveyConfigSchema,
  SURVEY_CONFIG_DEFAULTS,
  canSendSurvey,
  extractFirstName,
  type SurveyConfig,
} from '@/lib/rules/survey-config'

export const maxDuration = 60

const LANGUAGE_CODE = 'es_CO'

interface ClinicRow {
  id: string
  name: string
  whatsapp_config: unknown
  feature_config: unknown
}

interface PendingAppointment {
  id: string
  clinic_id: string
  starts_at: string
  patients: { name: string; phone: string; first_name: string | null } | null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const rateLimit = checkRateLimit('cron:survey-post-consulta', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  console.log('[Cron:Survey] Iniciando ciclo...')

  const { data: clinics, error: clinicsErr } = await supabaseAdmin
    .from('clinics')
    .select('id, name, whatsapp_config, feature_config')
    .in('subscription_status', ['trial', 'active'])

  if (clinicsErr) {
    console.error('[Cron:Survey] Error consultando clinics:', clinicsErr)
    return NextResponse.json({ error: 'Error consultando clínicas' }, { status: 500 })
  }

  let totalSent = 0
  let totalFailed = 0
  let clinicsProcessed = 0

  for (const clinic of (clinics ?? []) as ClinicRow[]) {
    // Gate 1: feature flag maestro
    const featureFlagOn = (clinic.feature_config as Record<string, unknown> | null)?.survey_post_consulta_enabled === true
    if (!featureFlagOn) continue

    // Gate 2: config específica de la clínica
    const rawSurvey = (clinic.whatsapp_config as Record<string, unknown> | null)?.automations as Record<string, unknown> | undefined
    const parsed = SurveyConfigSchema.safeParse(rawSurvey?.survey ?? {})
    const cfg: SurveyConfig = parsed.success ? parsed.data : SURVEY_CONFIG_DEFAULTS

    const gate = canSendSurvey(cfg)
    if (!gate.ok) {
      console.log(`[Cron:Survey] Clínica ${clinic.id} skip: ${gate.reason}`)
      continue
    }

    clinicsProcessed++
    const { sent, failed } = await processClinicSurveys(clinic, cfg)
    totalSent += sent
    totalFailed += failed
  }

  console.log(`[Cron:Survey] Completado — clinics=${clinicsProcessed}, sent=${totalSent}, failed=${totalFailed}`)
  return NextResponse.json({
    status: 'ok',
    clinicsProcessed,
    sent: totalSent,
    failed: totalFailed,
  })
}

async function processClinicSurveys(
  clinic: ClinicRow,
  cfg: SurveyConfig,
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  const guardrailIso = new Date(Date.now() - cfg.guardrail_hours * 60 * 60 * 1000).toISOString()

  // Citas facturadas SIN encuesta, dentro del guardrail
  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, clinic_id, starts_at,
      patients (name, phone, first_name)
    `)
    .eq('clinic_id', clinic.id)
    .eq('attendance_outcome', 'facturado')
    .eq('survey_sent', false)
    .gte('starts_at', guardrailIso)
    .order('starts_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error(`[Cron:Survey] Clínica ${clinic.id} error query citas:`, error.message)
    return { sent: 0, failed: 0 }
  }

  const clinicCreds = await getClinicCreds(clinic.id)
  if (!clinicCreds) {
    console.warn(`[Cron:Survey] Clínica ${clinic.id} sin WhatsApp creds — skip`)
    return { sent: 0, failed: 0 }
  }

  const clinicDisplayName = cfg.clinic_display_name?.trim() || clinic.name

  for (const raw of (appointments ?? []) as unknown[]) {
    const apt = raw as PendingAppointment
    const patient = apt.patients
    if (!patient?.phone) {
      console.warn(`[Cron:Survey] Cita ${apt.id} sin phone — skip`)
      continue
    }

    const firstName = extractFirstName({
      first_name: patient.first_name ?? null,
      name: patient.name,
    })

    const whatsappNumber = patient.phone.replace('+', '')

    // form_url ya validada por canSendSurvey — es string no-null aquí
    const formUrl = cfg.form_url as string

    const result = await sendWhatsAppTemplate(
      whatsappNumber,
      cfg.template_name,
      LANGUAGE_CODE,
      [firstName, clinicDisplayName],
      formUrl,
      clinicCreds,
    )

    if (result.ok) {
      const { error: updateErr } = await supabaseAdmin
        .from('appointments')
        .update({
          survey_sent: true,
          survey_sent_at: new Date().toISOString(),
        })
        .eq('id', apt.id)

      if (updateErr) {
        console.error(`[Cron:Survey] Cita ${apt.id}: envío OK pero UPDATE falló — riesgo de reenvío:`, updateErr.message)
        failed++
        continue
      }

      // Audit (sin datos sensibles — solo IDs + first 4 phone)
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinic.id,
        action: 'survey_sent',
        actor_type: 'system',
        target_type: 'appointment',
        target_id: apt.id,
        details: {
          template_name: cfg.template_name,
          language_code: LANGUAGE_CODE,
          phone_last4: whatsappNumber.slice(-4),
          message_id: result.messageId ?? null,
          form_url_domain: safeDomain(formUrl),
        },
      })

      sent++
    } else {
      console.error(`[Cron:Survey] Cita ${apt.id} fallo Meta code=${result.errorCode}: ${result.error}`)
      failed++
      // survey_sent queda en false → reintento el próximo ciclo si sigue dentro del guardrail
    }
  }

  return { sent, failed }
}

// Solo dominio para audit — evita loggear URLs con query params sensibles.
function safeDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'invalid_url'
  }
}
