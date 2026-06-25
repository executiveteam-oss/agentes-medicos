// Schema y tipos del condition_config para reglas patient_condition.
// Ver CLAUDE.md sección "Sistema de reglas configurables - Bloque 3".
//
// UNA pregunta por fila. Múltiples preguntas para un CT = múltiples filas
// con rule_type='patient_condition' en consultation_type_rules.
//
// Dos question_type soportados:
//   'yes_no'           — pregunta clásica (default, retrocompat con bloque 3 v1)
//   'multiple_choice'  — opciones entre 2-6, cada una con action_if_chosen
//
// RETROCOMPAT crítica: las filas de v1 en producción NO tienen 'question_type'
// en su condition_config. El preprocessor las trata como 'yes_no'. NO romper.

import { z } from 'zod'

const TRIGGER_ANSWERS = ['yes', 'no'] as const
export type TriggerAnswer = (typeof TRIGGER_ANSWERS)[number]

const ACTION_ON_TRIGGER = ['rechazar', 'derivar_humano'] as const
export type ActionOnTrigger = (typeof ACTION_ON_TRIGGER)[number]

const VERIFICATION_MODES = ['trust'] as const
export type VerificationMode = (typeof VERIFICATION_MODES)[number]

// --- Question types ---

const QUESTION_TYPES = ['yes_no', 'multiple_choice'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

// --- Multi-choice option ---

const OPTION_ACTIONS = ['continuar', 'derivar_humano', 'rechazar'] as const
export type OptionAction = (typeof OPTION_ACTIONS)[number]

export const PatientConditionOptionSchema = z.object({
  id: z.string().trim().min(1, 'El id de la opción no puede estar vacío').max(40, 'El id no puede exceder 40 caracteres'),
  label: z.string().trim().min(2, 'La etiqueta de la opción debe tener al menos 2 caracteres').max(100, 'La etiqueta no puede exceder 100 caracteres'),
  action_if_chosen: z.enum(OPTION_ACTIONS),
})

export type PatientConditionOption = z.infer<typeof PatientConditionOptionSchema>

// --- Discriminated union ---

const YesNoSchema = z.object({
  question: z.string().trim().min(5, 'La pregunta debe tener al menos 5 caracteres').max(200, 'La pregunta no puede exceder 200 caracteres'),
  question_type: z.literal('yes_no'),
  trigger_answer: z.enum(TRIGGER_ANSWERS),
  action_on_trigger: z.enum(ACTION_ON_TRIGGER),
  verification_mode: z.enum(VERIFICATION_MODES).default('trust'),
})

const MultipleChoiceSchema = z
  .object({
    question: z.string().trim().min(5, 'La pregunta debe tener al menos 5 caracteres').max(200, 'La pregunta no puede exceder 200 caracteres'),
    question_type: z.literal('multiple_choice'),
    options: z
      .array(PatientConditionOptionSchema)
      .min(2, 'Debes configurar al menos 2 opciones')
      .max(6, 'Máximo 6 opciones'),
    verification_mode: z.enum(VERIFICATION_MODES).default('trust'),
  })
  .superRefine((data, ctx) => {
    // Al menos una opción con action 'continuar' (sino la pregunta siempre bloquea)
    const hasContinuar = data.options.some((o) => o.action_if_chosen === 'continuar')
    if (!hasContinuar) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Al menos una opción debe tener acción "Continuar"',
        path: ['options'],
      })
    }
    // Ids únicos
    const ids = data.options.map((o) => o.id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Los identificadores de las opciones no pueden repetirse',
        path: ['options'],
      })
    }
    // Labels únicos (case-insensitive)
    const labels = data.options.map((o) => o.label.toLowerCase().trim())
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Las etiquetas de las opciones no pueden repetirse',
        path: ['options'],
      })
    }
  })

// Preprocessor para retrocompat: si la config vieja no tiene question_type,
// asumimos 'yes_no'. Esto preserva las reglas activas en producción
// (la de embarazo de Algia) sin requerir migración de datos.
export const PatientConditionConfigSchema = z.preprocess(
  (input) => {
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      const obj = input as Record<string, unknown>
      if (!('question_type' in obj)) {
        return { ...obj, question_type: 'yes_no' }
      }
    }
    return input
  },
  z.discriminatedUnion('question_type', [YesNoSchema, MultipleChoiceSchema]),
)

export type PatientConditionConfig = z.infer<typeof PatientConditionConfigSchema>
export type PatientConditionConfigYesNo = z.infer<typeof YesNoSchema>
export type PatientConditionConfigMultipleChoice = z.infer<typeof MultipleChoiceSchema>

// --- Answer categories ---

// yes_no: 'yes' | 'no' | 'ambiguous'
// multiple_choice: id de la opción elegida o 'ambiguous'
// El executor sabe cuál esperar leyendo question_type de la regla.
export const PATIENT_ANSWER_CATEGORIES = ['yes', 'no', 'ambiguous'] as const
export type PatientAnswerCategory = (typeof PATIENT_ANSWER_CATEGORIES)[number]
export const PatientAnswerSchema = z.enum(PATIENT_ANSWER_CATEGORIES)

// --- Evaluator ---

export type EvaluationResult =
  | { outcome: 'apt'; action: null }
  | { outcome: 'ambiguous'; action: 'derivar_humano' }
  | { outcome: 'triggered'; action: ActionOnTrigger; option_id?: string; option_label?: string }
  | { outcome: 'invalid_option'; action: 'derivar_humano'; option_id_reported?: string }

/**
 * Evalúa una respuesta del paciente contra la config.
 * - 'ambiguous' siempre deriva (safe default).
 * - yes_no: compara con trigger_answer, aplica action_on_trigger si matchea.
 * - multiple_choice: busca la opción por id, aplica action_if_chosen.
 *   Si el id no existe en options → safe default derivar (LLM se inventó algo).
 */
export function evaluatePatientCondition(
  answer: string,
  config: PatientConditionConfig,
): EvaluationResult {
  if (answer === 'ambiguous') {
    return { outcome: 'ambiguous', action: 'derivar_humano' }
  }

  if (config.question_type === 'yes_no') {
    if (answer !== 'yes' && answer !== 'no') {
      // Para yes_no esperamos 'yes' | 'no' | 'ambiguous'. Si llega otra cosa,
      // safe default = derivar (LLM mandó algo no válido).
      return { outcome: 'invalid_option', action: 'derivar_humano', option_id_reported: answer }
    }
    if (answer === config.trigger_answer) {
      return { outcome: 'triggered', action: config.action_on_trigger }
    }
    return { outcome: 'apt', action: null }
  }

  // multiple_choice path
  return evaluateMultipleChoice(answer, config)
}

function evaluateMultipleChoice(
  answer: string,
  config: PatientConditionConfigMultipleChoice,
): EvaluationResult {
  const option = config.options.find((o) => o.id === answer)
  if (!option) {
    return { outcome: 'invalid_option', action: 'derivar_humano', option_id_reported: answer }
  }
  if (option.action_if_chosen === 'continuar') {
    return { outcome: 'apt', action: null }
  }
  // 'derivar_humano' o 'rechazar'
  return {
    outcome: 'triggered',
    action: option.action_if_chosen,
    option_id: option.id,
    option_label: option.label,
  }
}

/**
 * Deriva la acción a almacenar en el column 'action' de la fila (informativa).
 * yes_no → action_on_trigger. multiple_choice → la más bloqueante entre opciones.
 */
export function deriveRowActionFromPatientConditionConfig(
  config: PatientConditionConfig,
): ActionOnTrigger {
  if (config.question_type === 'yes_no') return config.action_on_trigger
  // multiple_choice — buscar la más bloqueante
  const actions = config.options.map((o) => o.action_if_chosen)
  if (actions.includes('rechazar')) return 'rechazar'
  if (actions.includes('derivar_humano')) return 'derivar_humano'
  return 'derivar_humano' // fallback (en realidad nunca llega — Zod exige al menos una continuar pero también puede haber solo continuar/derivar)
}
