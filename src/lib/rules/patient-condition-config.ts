// Schema y tipos del condition_config para reglas patient_condition.
// Ver CLAUDE.md sección "Sistema de reglas configurables - Bloque 3".
//
// UNA pregunta por fila. Múltiples preguntas para un CT = múltiples filas
// con rule_type='patient_condition' en consultation_type_rules.

import { z } from 'zod'

const TRIGGER_ANSWERS = ['yes', 'no'] as const
export type TriggerAnswer = (typeof TRIGGER_ANSWERS)[number]

const ACTION_ON_TRIGGER = ['rechazar', 'derivar_humano'] as const
export type ActionOnTrigger = (typeof ACTION_ON_TRIGGER)[number]

// 'trust' = confiar en la respuesta interpretada por el LLM.
// 'verify' está reservado para el futuro — staff revisa antes de agendar.
const VERIFICATION_MODES = ['trust'] as const
export type VerificationMode = (typeof VERIFICATION_MODES)[number]

export const PatientConditionConfigSchema = z.object({
  question: z.string().trim().min(5, 'La pregunta debe tener al menos 5 caracteres').max(200, 'La pregunta no puede exceder 200 caracteres'),
  trigger_answer: z.enum(TRIGGER_ANSWERS),
  action_on_trigger: z.enum(ACTION_ON_TRIGGER),
  verification_mode: z.enum(VERIFICATION_MODES).default('trust'),
})

export type PatientConditionConfig = z.infer<typeof PatientConditionConfigSchema>

// Categoría que el LLM asigna a la respuesta del paciente.
// 'ambiguous' fuerza derivación (safe default), independiente de action_on_trigger.
export const PATIENT_ANSWER_CATEGORIES = ['yes', 'no', 'ambiguous'] as const
export type PatientAnswerCategory = (typeof PATIENT_ANSWER_CATEGORIES)[number]

export const PatientAnswerSchema = z.enum(PATIENT_ANSWER_CATEGORIES)

/**
 * Evalúa una respuesta del paciente contra la config.
 * - Si la respuesta es 'ambiguous' → derivar siempre (safe default).
 * - Si coincide con trigger_answer → aplicar action_on_trigger.
 * - Si NO coincide con trigger_answer → null (paciente apto, continuar).
 */
export function evaluatePatientCondition(
  answer: PatientAnswerCategory,
  config: PatientConditionConfig,
): { outcome: 'ambiguous' | 'triggered' | 'apt'; action: ActionOnTrigger | null } {
  if (answer === 'ambiguous') {
    return { outcome: 'ambiguous', action: 'derivar_humano' }
  }
  if (answer === config.trigger_answer) {
    return { outcome: 'triggered', action: config.action_on_trigger }
  }
  return { outcome: 'apt', action: null }
}
