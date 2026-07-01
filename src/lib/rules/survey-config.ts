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
