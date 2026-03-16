// ============================================================
// Rastreo de uso de API por clínica — Límite mensual de tokens
//
// Basic: 100.000 tokens/mes | Pro: 500.000 tokens/mes
// Si se excede, el agente se pausa y notifica al admin
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { format } from 'date-fns'

// Límites por plan (input + output tokens combinados)
const TOKEN_LIMITS: Record<string, number> = {
  basic: 100_000,
  pro: 500_000,
}

/**
 * Obtiene el mes actual en formato YYYY-MM
 */
function currentMonth(): string {
  return format(new Date(), 'yyyy-MM')
}

/**
 * Registra tokens usados por una clínica y verifica el límite.
 * Retorna true si la clínica puede seguir usando la API.
 * Retorna false si se excedió el límite (agente pausado).
 */
export async function trackTokenUsage(
  clinicId: string,
  inputTokens: number,
  outputTokens: number
): Promise<boolean> {
  const month = currentMonth()

  // Upsert: crear fila si no existe, sumar tokens si existe
  const { data, error } = await supabaseAdmin
    .from('api_usage')
    .upsert(
      {
        clinic_id: clinicId,
        month,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        api_calls: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,month' }
    )
    .select('id')
    .single()

  if (error && error.code === '23505') {
    // Fila ya existe — sumar con RPC o query manual
    await supabaseAdmin.rpc('increment_api_usage', {
      p_clinic_id: clinicId,
      p_month: month,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
    }).then(undefined, async () => {
      // Fallback si la función RPC no existe: leer + actualizar
      const { data: current } = await supabaseAdmin
        .from('api_usage')
        .select('input_tokens, output_tokens, api_calls')
        .eq('clinic_id', clinicId)
        .eq('month', month)
        .single()

      if (current) {
        await supabaseAdmin
          .from('api_usage')
          .update({
            input_tokens: (current.input_tokens ?? 0) + inputTokens,
            output_tokens: (current.output_tokens ?? 0) + outputTokens,
            api_calls: (current.api_calls ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('clinic_id', clinicId)
          .eq('month', month)
      }
    })
  } else if (error) {
    console.error('[api-usage] Error tracking:', error.message)
    // No bloquear la funcionalidad si falla el tracking
    return true
  }

  // Verificar si se excedió el límite
  return !(await isClinicPaused(clinicId))
}

/**
 * Verifica si una clínica ha sido pausada por exceder el límite de tokens.
 * Si el total supera el límite, pausa la clínica.
 */
export async function isClinicPaused(clinicId: string): Promise<boolean> {
  const month = currentMonth()

  const { data: usage } = await supabaseAdmin
    .from('api_usage')
    .select('input_tokens, output_tokens, paused_at')
    .eq('clinic_id', clinicId)
    .eq('month', month)
    .single()

  if (!usage) return false

  // Si ya está pausada
  if (usage.paused_at) return true

  // Obtener plan de la clínica
  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('subscription_plan')
    .eq('id', clinicId)
    .single()

  const plan = clinic?.subscription_plan ?? 'basic'
  const limit = TOKEN_LIMITS[plan] ?? TOKEN_LIMITS.basic
  const totalTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)

  if (totalTokens >= limit) {
    // Pausar la clínica
    await supabaseAdmin
      .from('api_usage')
      .update({ paused_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('month', month)

    console.warn(`[api-usage] Clínica ${clinicId} PAUSADA — ${totalTokens} tokens usados (límite: ${limit})`)
    return true
  }

  return false
}

/**
 * Obtiene el uso actual de una clínica para el mes en curso.
 */
export async function getClinicUsage(clinicId: string): Promise<{
  inputTokens: number
  outputTokens: number
  totalTokens: number
  apiCalls: number
  limit: number
  paused: boolean
  percentUsed: number
}> {
  const month = currentMonth()

  const { data: usage } = await supabaseAdmin
    .from('api_usage')
    .select('input_tokens, output_tokens, api_calls, paused_at')
    .eq('clinic_id', clinicId)
    .eq('month', month)
    .single()

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('subscription_plan')
    .eq('id', clinicId)
    .single()

  const plan = clinic?.subscription_plan ?? 'basic'
  const limit = TOKEN_LIMITS[plan] ?? TOKEN_LIMITS.basic
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  const totalTokens = inputTokens + outputTokens

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    apiCalls: usage?.api_calls ?? 0,
    limit,
    paused: !!usage?.paused_at,
    percentUsed: Math.round((totalTokens / limit) * 100),
  }
}
