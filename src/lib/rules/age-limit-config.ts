// Schema y tipos del condition_config para reglas age_limit.
// Ver CLAUDE.md sección "Sistema de reglas configurables - Bloque 2".

import { z } from 'zod'

const EDGE_ACTIONS = ['rechazar', 'derivar_humano'] as const
export type EdgeAction = (typeof EDGE_ACTIONS)[number]

// Schema crudo: ambos extremos opcionales. Las restricciones cruzadas
// (al menos uno, action requerida si el extremo está presente, min<max)
// las valida superRefine.
export const AgeLimitConfigSchema = z
  .object({
    min: z.number().int().min(0).max(120).optional(),
    max: z.number().int().min(0).max(120).optional(),
    action_below_min: z.enum(EDGE_ACTIONS).optional(),
    action_above_max: z.enum(EDGE_ACTIONS).optional(),
  })
  .superRefine((data, ctx) => {
    const hasMin = data.min !== undefined
    const hasMax = data.max !== undefined

    if (!hasMin && !hasMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Debes configurar al menos edad mínima o edad máxima',
      })
      return
    }

    if (hasMin && data.action_below_min === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Si configurás edad mínima, debes elegir una acción',
        path: ['action_below_min'],
      })
    }

    if (hasMax && data.action_above_max === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Si configurás edad máxima, debes elegir una acción',
        path: ['action_above_max'],
      })
    }

    if (hasMin && hasMax && data.min! >= data.max!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La edad mínima debe ser menor que la máxima',
        path: ['min'],
      })
    }
  })

export type AgeLimitConfig = z.infer<typeof AgeLimitConfigSchema>

/**
 * Decide la acción a tomar dada una edad concreta y la config.
 * Devuelve null si la edad está DENTRO de rango (no aplica).
 */
export function evaluateAgeLimit(
  age: number,
  config: AgeLimitConfig,
): { edge: 'below_min' | 'above_max'; action: EdgeAction } | null {
  if (config.min !== undefined && age < config.min) {
    return { edge: 'below_min', action: config.action_below_min! }
  }
  if (config.max !== undefined && age > config.max) {
    return { edge: 'above_max', action: config.action_above_max! }
  }
  return null
}

/**
 * Para decidir el `action` column de la fila (defense in depth — fuente
 * de verdad sigue siendo condition_config). Si hay dos acciones distintas,
 * "rechazar" gana sobre "derivar_humano" para mantener el column reflejando
 * la respuesta más restrictiva.
 */
export function deriveRowActionFromConfig(config: AgeLimitConfig): EdgeAction {
  const actions = [config.action_below_min, config.action_above_max].filter(
    (a): a is EdgeAction => a !== undefined,
  )
  if (actions.includes('rechazar')) return 'rechazar'
  return 'derivar_humano'
}
