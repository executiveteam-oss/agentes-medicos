// ============================================================
// Envío INMEDIATO de la encuesta de satisfacción, al marcar "Facturado".
//
// POR QUÉ EXISTE: el equipo marca la cita apenas la paciente sale, no en lote.
// Esperar a la corrida del cron metía hasta 59 minutos entre la consulta y la
// encuesta. Acá sale en el momento; el cron queda como RED, no como camino
// principal.
//
// EL RIESGO QUE RESUELVE — doble envío. El botón y el cron pueden mirar la
// misma cita a la vez, o el botón puede enviar y morirse antes de marcarla.
// La defensa es RECLAMAR la fila antes de enviar:
//
//   UPDATE … SET survey_sent = true WHERE survey_sent = false RETURNING id
//
// Postgres garantiza que solo UNO de los dos flujos se lleva la fila. El que
// recibe cero filas sabe que perdió y no envía. Mismo patrón que ya usa
// markSurveySentManually (survey-config.ts:161).
//
// Y SI EL ENVÍO FALLA se DEVUELVE el flag a false, para que el cron reintente.
// Sin eso, protegerse del duplicado costaría perder la encuesta en silencio:
// marcada como enviada sin haber salido nunca.
//
// VENTANA RESIDUAL, conocida y aceptada: entre el envío y el rollback hay
// milisegundos en que, si el proceso muere, la fila queda reclamada sin envío.
// Deja una huella reconocible — survey_sent=true con survey_sent_at NULL — que
// el cron levanta (ver el guard de rescate en survey-post-consulta/route.ts).
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppTemplate, getClinicCreds } from '@/lib/whatsapp/client'
import {
  SurveyConfigSchema,
  SURVEY_CONFIG_DEFAULTS,
  canSendSurvey,
  extractFirstName,
  SURVEY_BUTTON_URL_SUFFIX,
} from '@/lib/rules/survey-config'

const LANGUAGE_CODE = 'es'

export type SendSurveyNowResult =
  | { sent: true }
  | { sent: false; reason: string }

export async function sendSurveyNow(
  appointmentId: string,
  clinicId: string,
): Promise<SendSurveyNowResult> {
  try {
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('name, whatsapp_config, feature_config')
      .eq('id', clinicId)
      .single()
    if (!clinic) return { sent: false, reason: 'clinica_no_encontrada' }

    // Gate maestro + gate de la clínica. Mismos que evalúa el cron.
    const featureOn =
      (clinic.feature_config as Record<string, unknown> | null)?.survey_post_consulta_enabled === true
    if (!featureOn) return { sent: false, reason: 'feature_flag_off' }

    const automations = (clinic.whatsapp_config as Record<string, unknown> | null)?.automations as
      | Record<string, unknown>
      | undefined
    const parsed = SurveyConfigSchema.safeParse(automations?.survey ?? {})
    const cfg = parsed.success ? parsed.data : SURVEY_CONFIG_DEFAULTS
    const gate = canSendSurvey(cfg)
    if (!gate.ok) return { sent: false, reason: `config: ${gate.reason}` }

    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('id, attendance_outcome, survey_sent, patients (name, phone, first_name, proactive_contact_opt_in)')
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (!apt) return { sent: false, reason: 'cita_no_encontrada' }

    const a = apt as unknown as {
      attendance_outcome: string | null
      survey_sent: boolean
      patients: { name: string; phone: string | null; first_name: string | null; proactive_contact_opt_in: boolean } | null
    }
    if (a.attendance_outcome !== 'facturado') return { sent: false, reason: 'no_facturada' }
    if (a.survey_sent) return { sent: false, reason: 'ya_enviada' }

    const patient = a.patients
    if (!patient?.phone) return { sent: false, reason: 'sin_telefono' }
    // Mismo gate de canal proactivo que los demás envíos automáticos.
    if (patient.proactive_contact_opt_in !== true) return { sent: false, reason: 'sin_opt_in' }

    const creds = await getClinicCreds(clinicId)
    if (!creds) return { sent: false, reason: 'clinica_sin_whatsapp' }

    // ---- RECLAMO ATÓMICO: quien se lleva la fila, envía. ----
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('appointments')
      .update({ survey_sent: true, survey_sent_at: new Date().toISOString() })
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .eq('survey_sent', false)
      .select('id')
    if (claimErr) return { sent: false, reason: 'error_reclamando' }
    if (!claimed || claimed.length === 0) return { sent: false, reason: 'reclamada_por_otro_flujo' }

    const firstName = extractFirstName({ first_name: patient.first_name, name: patient.name })
    const clinicDisplayName = cfg.clinic_display_name?.trim() || (clinic.name as string)

    const result = await sendWhatsAppTemplate(
      patient.phone.replace('+', ''),
      cfg.template_name,
      LANGUAGE_CODE,
      [firstName, clinicDisplayName],
      // NO es la URL: Meta concatena esto a la base aprobada. Ver la constante.
      SURVEY_BUTTON_URL_SUFFIX,
      creds,
      { clinicId, sendType: 'survey' },
    )

    if (result.ok) {
      await supabaseAdmin.from('audit_log').insert({
        clinic_id: clinicId,
        action: 'survey_sent',
        actor_type: 'staff',
        target_type: 'appointment',
        target_id: appointmentId,
        details: {
          via: 'inmediato_al_facturar',
          template_name: cfg.template_name,
          message_id: result.messageId ?? null,
          button_url_suffix: SURVEY_BUTTON_URL_SUFFIX,
        },
      })
      return { sent: true }
    }

    // ---- ROLLBACK: el envío falló, se devuelve la fila para que el cron reintente ----
    await supabaseAdmin
      .from('appointments')
      .update({ survey_sent: false, survey_sent_at: null })
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)

    console.error(`[sendSurveyNow] Cita ${appointmentId} falló (code=${result.errorCode}) — devuelta al cron`)
    return { sent: false, reason: `meta_error_${result.errorCode ?? 'desconocido'}` }
  } catch (err) {
    // Nunca tumbar la acción principal: marcar Facturado ya se guardó.
    console.error('[sendSurveyNow] error no crítico:', err instanceof Error ? err.message : err)
    return { sent: false, reason: 'excepcion' }
  }
}
