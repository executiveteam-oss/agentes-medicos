// ============================================================
// Feature: encuesta post-consulta
//
// Config vive en clinics.whatsapp_config.automations.survey (JSONB).
// Doble gate: feature_config.survey_post_consulta_enabled (maestro por clínica)
// + este .enabled (toggle de la clínica en la UI).
//
// Template Meta: multi-tenancy real (cada clínica tiene su propio Meta Business
// y aprueba SU propio template). El texto es fijo (para pasar aprobación
// Meta consistente), las variables las inyecta el cron por cita.
// ============================================================

import { z } from 'zod'

export const SurveyConfigSchema = z.object({
  /**
   * Toggle de la clínica en la UI. Con este en false NO se envía.
   * Se puede desactivar mientras se ajustan los otros campos sin
   * perder la config.
   */
  enabled: z.boolean().default(false),

  /**
   * Nombre exacto del template aprobado en Meta Business Manager.
   * Cada clínica somete su propio template con su Meta account.
   * Default 'encuesta_satisfaccion' pero cada clínica puede overridear
   * si aprobaron con otro nombre.
   */
  template_name: z.string().min(1).max(80).default('encuesta_satisfaccion'),

  /**
   * URL completa del formulario (Google Forms, Typeform, etc).
   * Se pasa como variable dinámica al botón CTA del template.
   * NULL = no configurada aún = no envía (aunque enabled sea true).
   */
  form_url: z.string().url().nullable().default(null),

  /**
   * Cómo aparece el nombre de la clínica en el mensaje ({{2}}).
   * NULL = usar clinics.name como default en runtime.
   * Útil cuando la clínica quiere un nombre largo o formal en el mensaje
   * (ej. "ALGIA UNIDAD DE LAPAROSCOPIA GINECOLOGICA AVANZADA Y DOLOR PELVICO")
   * pero mantener clinics.name como el short-name para el resto del sistema.
   */
  clinic_display_name: z.string().max(200).nullable().default(null),

  /**
   * Solo enviar encuesta a citas cuyo starts_at es más reciente que
   * (now - guardrail_hours). Anti-extemporaneidad: si el cron cae 3 días
   * y se recupera, NO manda encuestas viejas de la nada.
   * Default 48h cubre día normal + 1 día de gracia.
   */
  guardrail_hours: z.number().int().min(1).max(168).default(48),

  /**
   * Frecuencia parametrizable (informativa, para futuro).
   * Hoy el cron vive en vercel.json con schedule fijo. Este campo se
   * usa solo para display en la UI; cambiarlo NO cambia el schedule real.
   */
  cron_frequency_minutes: z.number().int().min(15).max(1440).default(60),
})

export type SurveyConfig = z.infer<typeof SurveyConfigSchema>

/**
 * Default con TODOS los campos poblados. Útil para inicializar una clínica
 * que nunca configuró el feature. El schema tiene defaults pero z.parse(undefined)
 * no invoca defaults en algunos casos edge — este helper es explícito.
 */
export const SURVEY_CONFIG_DEFAULTS: SurveyConfig = {
  enabled: false,
  template_name: 'encuesta_satisfaccion',
  form_url: null,
  clinic_display_name: null,
  guardrail_hours: 48,
  cron_frequency_minutes: 60,
}

/**
 * Runtime check: ¿esta clínica puede enviar la encuesta AHORA?
 * NO chequea el feature flag maestro (ese vive en feature_config).
 * Este es el gate 2 (config de la clínica).
 */
export function canSendSurvey(
  cfg: SurveyConfig,
): { ok: true } | { ok: false; reason: string } {
  if (!cfg.enabled) return { ok: false, reason: 'Feature toggle deshabilitado por la clínica' }
  if (!cfg.form_url) return { ok: false, reason: 'form_url no configurada' }
  if (!cfg.template_name) return { ok: false, reason: 'template_name vacío' }
  return { ok: true }
}

/**
 * Extrae el primer nombre del paciente para la variable {{1}} del template.
 * Prioriza patients.first_name (poblado por Res-256), fallback a split del
 * patients.name completo.
 */
export function extractFirstName(
  patient: { first_name?: string | null; name: string },
): string {
  const explicit = patient.first_name?.trim()
  if (explicit && explicit.length > 0) return capitalize(explicit)

  // Fallback: split del name completo
  const parts = patient.name.trim().split(/\s+/)
  const first = parts[0] ?? ''
  if (first.length === 0) return 'hola'
  return capitalize(first)
}

function capitalize(s: string): string {
  // Nombres en iSalud vienen en MAYÚSCULAS ("LUZ ADRIANA"). Capitalizamos
  // para el mensaje WhatsApp (más natural).
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/**
 * TEXTO BASE del mensaje de encuesta (sin link).
 * DEBE ser idéntico al BODY del template Meta.
 * El snapshot test protege esta consistencia.
 *
 * Si cambia, hay que:
 *   1. Coordinar re-aprobación del template Meta con cada clínica
 *   2. Actualizar TEMPLATE_BODY_TEXT en survey-form.tsx (o al revés)
 *   3. Actualizar el snapshot test
 */
/**
 * SUFIJO que se manda como parámetro {{1}} del botón URL del template.
 *
 * NO es la URL del formulario. En un botón de URL dinámica, Meta CONCATENA el
 * parámetro a la base aprobada — no la reemplaza. La base aprobada de Algia ya
 * trae el formulario entero y termina en `?usp=header`:
 *
 *   https://docs.google.com/forms/d/e/1FAIp…/viewform?usp=header{{1}}
 *
 * Mandar la URL completa como parámetro la duplicaba y producía un link roto.
 * Con `&src=wa` queda una URL válida y además marca el origen del tráfico.
 *
 * ⚠ CONSECUENCIA A TENER PRESENTE: para el envío AUTOMÁTICO, el formulario está
 * horneado en el template aprobado en Meta, no en la config. Cambiar `form_url`
 * en Automatizaciones cambia el envío MANUAL (wa.me) pero NO el automático.
 * Para cambiar de formulario en el automático hay que re-aprobar el template.
 *
 * DEUDA: lo correcto es re-aprobar con la base cortada en el prefijo estable
 * (`.../forms/d/e/{{1}}`) y mandar como parámetro el ID + `/viewform`. Así se
 * cambia de formulario sin pasar por Meta. No se hizo hoy porque implica
 * esperar la aprobación.
 */
export const SURVEY_BUTTON_URL_SUFFIX = '&src=wa'

export const SURVEY_MESSAGE_TEMPLATE =
  'Buen día {firstName}. Sería tan amable de diligenciar la encuesta de satisfacción de {clinicName}. Gracias por ayudarnos a mejorar nuestra atención.'

/**
 * Construye el mensaje de encuesta para envío MANUAL vía wa.me.
 *
 * Diferencia con el template Meta:
 *   - Template Meta usa {{1}}, {{2}} + botón CTA con URL en variable {{1}}
 *   - Manual usa {firstName}, {clinicName} + link concatenado al final del cuerpo
 *
 * El texto principal (SURVEY_MESSAGE_TEMPLATE) es idéntico entre los dos —
 * garantía de que la paciente reciba el MISMO wording, sea que se envíe
 * automático o manual. La diferencia visible para ella es solo el link:
 * en template aparece como botón "Responder encuesta"; en manual como URL
 * clickable al final del mensaje.
 */
export function buildSurveyMessage(params: {
  patientFirstName: string
  clinicDisplayName: string
  formUrl: string
}): string {
  const body = SURVEY_MESSAGE_TEMPLATE
    .replace('{firstName}', params.patientFirstName)
    .replace('{clinicName}', params.clinicDisplayName)
  return `${body}\n\n${params.formUrl}`
}
