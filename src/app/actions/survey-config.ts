'use server'

// ============================================================
// Server actions — feature "Encuesta post-consulta"
//
// Config vive en clinics.whatsapp_config.automations.survey (JSONB).
// Manejo con jsonb_set para preservar el resto del whatsapp_config
// (no pisar automations.post_consulta, automations.reactivacion, etc).
//
// Permission gate: 'settings' write (Admin + Coordinadora por default).
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, extractActionError, getSessionClinicId } from '@/lib/actions-helpers'
import {
  SurveyConfigSchema,
  SURVEY_CONFIG_DEFAULTS,
  type SurveyConfig,
} from '@/lib/rules/survey-config'
import { revalidatePath } from 'next/cache'

export interface SurveyConfigResult {
  config: SurveyConfig
  featureFlagEnabled: boolean
  clinicName: string
}

/**
 * Lee la config actual de survey + flag maestro + nombre de clínica para el
 * placeholder de la UI. Sin write, no requiere permisos de escritura.
 */
export async function getSurveyConfig(): Promise<SurveyConfigResult> {
  const clinicId = await getSessionClinicId()

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('name, whatsapp_config, feature_config')
    .eq('id', clinicId)
    .single()

  const rawSurvey = (clinic?.whatsapp_config as Record<string, unknown> | null)?.automations as Record<string, unknown> | undefined
  const parsed = SurveyConfigSchema.safeParse(rawSurvey?.survey ?? {})
  const config: SurveyConfig = parsed.success ? parsed.data : SURVEY_CONFIG_DEFAULTS

  const featureFlagEnabled =
    (clinic?.feature_config as Record<string, unknown> | null)?.survey_post_consulta_enabled === true

  return {
    config,
    featureFlagEnabled,
    clinicName: (clinic?.name as string) ?? '',
  }
}

/**
 * Actualiza campos parciales de la config survey.
 * Merge en memoria (leer whatsapp_config actual, spread, escribir todo).
 * jsonb_set sería más elegante pero requiere path anidado + escape de nulls,
 * y el merge en JS es más legible y suficientemente atómico para este caso
 * (una sola clínica, un solo update).
 */
export async function updateSurveyConfig(
  patch: Partial<SurveyConfig>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await checkWritePermission('settings')
    const clinicId = await getSessionClinicId()

    // Leer config actual
    const { data: clinic, error: readErr } = await supabaseAdmin
      .from('clinics')
      .select('whatsapp_config')
      .eq('id', clinicId)
      .single()

    if (readErr) return { ok: false, error: 'Error leyendo configuración' }

    const currentConfig = (clinic?.whatsapp_config as Record<string, unknown> | null) ?? {}
    const currentAutomations = (currentConfig.automations as Record<string, unknown> | null) ?? {}
    const currentSurvey = (currentAutomations.survey as Record<string, unknown> | null) ?? {}

    // Merge: patch sobre config actual
    const mergedSurvey = { ...currentSurvey, ...patch }

    // Validar el resultado completo
    const parsed = SurveyConfigSchema.safeParse(mergedSurvey)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      return { ok: false, error: `${firstIssue.path.join('.')}: ${firstIssue.message}` }
    }

    // Escribir manteniendo el resto del whatsapp_config intacto
    const newConfig = {
      ...currentConfig,
      automations: {
        ...currentAutomations,
        survey: parsed.data,
      },
    }

    const { error: writeErr } = await supabaseAdmin
      .from('clinics')
      .update({ whatsapp_config: newConfig })
      .eq('id', clinicId)

    if (writeErr) return { ok: false, error: 'Error guardando configuración' }

    revalidatePath('/dashboard/settings/automations/survey')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: extractActionError(err) }
  }
}

/**
 * Marcar una cita como "encuesta enviada manualmente" (Opción 3 click-to-chat).
 *
 * La secretaria abrió wa.me con el mensaje pre-cargado y confirmó que lo
 * envió. Este action solo persiste el hecho: NO envía nada por Meta.
 *
 * Validaciones defensivas:
 *   - Cita pertenece a la clínica de la sesión (multi-tenant)
 *   - attendance_outcome = 'facturado' (no dejar marcar encuesta en cita sin facturar)
 *   - survey_sent = false (idempotencia — evita doble marcado)
 *
 * Race condition contra el cron automático: el UPDATE con
 * WHERE survey_sent = false es atómico. Si ambos flujos corren en paralelo,
 * solo uno pega — el otro recibe rows_affected=0 y responde error suave.
 */
export async function markSurveySentManually(
  appointmentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await checkWritePermission('agenda')
    const clinicId = await getSessionClinicId()

    // Leer cita para validar estado + capturar phone para audit
    const { data: apt, error: readErr } = await supabaseAdmin
      .from('appointments')
      .select(`
        id, clinic_id, attendance_outcome, survey_sent,
        patients (phone)
      `)
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .maybeSingle()

    if (readErr || !apt) {
      return { ok: false, error: 'Cita no encontrada' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aptTyped = apt as any
    if (aptTyped.attendance_outcome !== 'facturado') {
      return { ok: false, error: 'La cita debe estar marcada como Facturada primero' }
    }
    if (aptTyped.survey_sent === true) {
      return { ok: false, error: 'La encuesta ya está marcada como enviada' }
    }

    // UPDATE atómico contra race con cron
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('appointments')
      .update({
        survey_sent: true,
        survey_sent_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .eq('survey_sent', false)
      .select('id')

    if (updateErr) {
      return { ok: false, error: 'Error guardando estado' }
    }
    if (!updated || updated.length === 0) {
      // Race lost — otro flujo ya marcó survey_sent=true
      return { ok: false, error: 'La encuesta ya fue marcada como enviada por otro proceso' }
    }

    // Audit log — distinto del automático (action='survey_sent') para poder
    // separarlos en reports futuros.
    const phone = (aptTyped.patients?.phone as string | undefined) ?? ''
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'survey_sent_manual',
      actor_type: 'staff',
      target_type: 'appointment',
      target_id: appointmentId,
      details: {
        phone_last4: phone.slice(-4),
      },
    })

    revalidatePath('/dashboard/agenda')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: extractActionError(err) }
  }
}
