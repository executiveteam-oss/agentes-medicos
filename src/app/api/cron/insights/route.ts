// ============================================================
// CRON JOB: Omuwan Insights — Recomendaciones IA diarias
// Schedule: "30 11 * * *" (6:30 AM Bogota)
//
// Para cada clínica con historial suficiente:
// 1. Verifica suficiencia de datos por categoría
// 2. Recolecta métricas solo para categorías con datos
// 3. Llama a Claude API con benchmarks reales
// 4. Guarda en clinic_insights con snapshot + confidence
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic } from '@/lib/anthropic/client'
import { verifyCronSecret } from '@/lib/rate-limit'
import { buildClinicSnapshot } from '@/app/actions/insights'
import type { InsightRecommendation, ClinicDataSnapshot } from '@/app/actions/insights'

export const maxDuration = 60

// ==================== BENCHMARKS ====================

const BENCHMARKS = `BENCHMARKS REALES (Colombia y América Latina):

No-shows:
- Promedio América Latina: 12-30% (rango normal)
- Promedio global todas las especialidades: 23%
- Consultorios colombianos con recordatorios WA: <10%
- Meta óptima para consultorio privado: 5-8%
- Pacientes con EPS tienen 2x más no-shows que particulares
- No-shows son más frecuentes los lunes y viernes
- Citas agendadas con >7 días de anticipación tienen 40% más probabilidad de no-show

Retención de pacientes:
- Sin seguimiento activo: 60% de pacientes nuevos no regresan después de la primera visita
- Con seguimiento por WhatsApp: tasa de retorno aumenta 35-40%
- Pacientes que regresan 3+ veces tienen 80% de probabilidad de ser recurrentes de largo plazo

Ocupación de agenda:
- Consultorio bien gestionado: 75-85% de ocupación
- Franjas de menor demanda típicas: lunes 7-9am, viernes después de las 3pm
- Implementar lista de espera activa reduce pérdidas por cancelación en 60-70%

Cartera:
- Deuda >30 días: 40% probabilidad de no pago
- Deuda >60 días: 70% probabilidad de no pago
- Primer recordatorio por WhatsApp recupera 35% de cartera vencida

Ingresos:
- Consultorio promedio Colombia pierde 15-25% de ingresos potenciales por ineficiencias operativas
- Recordatorios automáticos reducen no-shows 30-50% en primeros 90 días
- Reactivación de pacientes inactivos genera ROI promedio de 8:1`

// ==================== SYSTEM PROMPT ====================

const SYSTEM_PROMPT = `You are a world-class medical practice profitability consultant (McKinsey level).
You analyze clinic operational data and produce EXACTLY 3-5 actionable recommendations in JSON.

${BENCHMARKS}

RULES:
- Every recommendation MUST include a concrete COP dollar impact estimate
- Focus on: revenue recovery, no-show reduction, schedule optimization, patient retention, debt collection
- Be specific: "Move Tuesday 3PM slots to Thursday 10AM" not "optimize schedule"
- Use Colombian medical practice context (EPS, COP, festivos)
- Recommendations must be actionable THIS WEEK
- NEVER recommend hiring staff or buying equipment (these are small clinics)
- Output ONLY valid JSON array, no markdown, no explanation outside the JSON

REGLAS DE CALIDAD:
- Compara SIEMPRE con el benchmark relevante. Ejemplo: "Tu tasa de no-shows es 28%. El promedio en Colombia es 18-23%. Estás X puntos por encima."
- Cuantifica SIEMPRE el impacto en COP. Usa el precio de consulta real del consultorio.
- Sé ESPECÍFICO sobre el día/hora/médico/tipo cuando los datos lo permiten
- Da UNA acción concreta, no una lista
- Menciona el tiempo esperado para ver resultados. Ejemplo: "Con esto verías mejoras en 2-4 semanas"
- Si algo está bien, dilo con el benchmark: "Tu tasa de retorno (45%) está por encima del promedio Colombia (40%). Sigue así."
- NUNCA generes un insight si los datos no lo respaldan claramente`

// ==================== DATA THRESHOLDS ====================

interface DataAvailability {
  noshow: boolean
  occupancy: boolean
  retention: boolean
  revenue: boolean
  cartera: boolean
  reactivation: boolean
  availableCategories: string[]
}

function checkDataSufficiency(snapshot: ClinicDataSnapshot): DataAvailability {
  const completedOrNoShow = snapshot.total_appointments_90d > 0 // already filtered
  const noshow = completedOrNoShow && snapshot.total_appointments_90d >= 20
  const occupancy = snapshot.total_appointments_90d >= 20 // ~3 weeks of data at minimum
  const retention = snapshot.patient_return_rate >= 0 && snapshot.total_appointments_90d >= 15
  const revenue = snapshot.total_appointments_90d >= 30
  const cartera = snapshot.cartera_total > 0
  const reactivation = snapshot.patients_at_risk_count >= 0 && snapshot.total_appointments_90d >= 20

  const availableCategories: string[] = []
  if (noshow) availableCategories.push('noshow')
  if (occupancy) availableCategories.push('occupancy')
  if (retention) availableCategories.push('retention')
  if (revenue) availableCategories.push('revenue')
  if (cartera) availableCategories.push('cartera')
  if (reactivation) availableCategories.push('reactivation')

  return { noshow, occupancy, retention, revenue, cartera, reactivation, availableCategories }
}

// ==================== USER PROMPT ====================

function buildUserPrompt(
  clinicName: string,
  snapshot: Record<string, unknown>,
  availability: DataAvailability
): string {
  const categoryNotes = availability.availableCategories.map((c) => {
    switch (c) {
      case 'noshow': return '- No-show analysis: SUFFICIENT data (include no-show insights)'
      case 'occupancy': return '- Occupancy analysis: SUFFICIENT data (include schedule optimization insights)'
      case 'retention': return '- Patient retention: SUFFICIENT data (include retention insights)'
      case 'revenue': return '- Revenue analysis: SUFFICIENT data (include revenue insights)'
      case 'cartera': return '- Cartera/debt: HAS pending debt (include debt collection insights)'
      case 'reactivation': return '- Patient reactivation: SUFFICIENT data (include reactivation insights)'
      default: return ''
    }
  }).filter(Boolean).join('\n')

  return `Analyze this clinic's data and generate 3-5 prioritized recommendations.
ONLY generate insights for categories where data is available (listed below).

CLINIC: ${clinicName}

DATA AVAILABILITY:
${categoryNotes}

DATA (last 90 days):
${JSON.stringify(snapshot, null, 2)}

Return a JSON array where each element has:
{
  "type": "OPORTUNIDAD" | "ALERTA" | "RIESGO" | "LOGRO",
  "title": "short actionable title (max 60 chars)",
  "impact_cop": number (estimated COP impact, positive = money recovered/gained),
  "observation": "what the data shows — ALWAYS compare to the benchmark (1-2 sentences, reference specific numbers from data AND from benchmarks)",
  "action": "exact step to take this week + expected timeline for results (1-2 sentences)",
  "module": "agenda" | "noshow" | "cartera" | "espera" | "patients" | "facturacion",
  "confidence": 1 | 2 | 3
}

CONFIDENCE SCORING:
- 1 = based on limited data, indicative only (use when category barely meets threshold)
- 2 = based on solid data, reliable (use when category has good data volume)
- 3 = based on extensive data, high confidence (use when data is abundant and trend is clear)

IMPORTANT:
- At least 1 must be type "OPORTUNIDAD" (revenue opportunity)
- If no_show_rate > 15%, include an "ALERTA" about it — compare to benchmark
- If cartera_total > 0, include a "RIESGO" about overdue payments — mention days overdue vs benchmark
- If there's something genuinely good vs benchmarks, include a "LOGRO"
- impact_cop must be realistic based on consultation_price and volumes
- ALWAYS reference the specific benchmark number in your observation
- Sort by impact_cop descending`
}

// ==================== HANDLER ====================

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const results: Array<{ clinicId: string; status: string; recommendations?: number }> = []

  try {
    // Obtener clínicas activas con onboarding completado
    const { data: clinics } = await supabaseAdmin
      .from('clinics')
      .select('id, name')
      .not('onboarded_at', 'is', null)

    if (!clinics || clinics.length === 0) {
      return NextResponse.json({ message: 'No hay clínicas activas', results })
    }

    for (const clinic of clinics) {
      try {
        // Verificar que no se haya generado hoy
        const todayStart = new Date()
        todayStart.setUTCHours(0, 0, 0, 0)
        const { count: existingToday } = await supabaseAdmin
          .from('clinic_insights')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic.id)
          .gte('generated_at', todayStart.toISOString())

        if (existingToday && existingToday > 0) {
          results.push({ clinicId: clinic.id, status: 'skipped_already_generated' })
          continue
        }

        // Paso 1: Recolectar métricas
        const snapshot = await buildClinicSnapshot(clinic.id)
        if (!snapshot) {
          results.push({ clinicId: clinic.id, status: 'skipped_no_clinic' })
          continue
        }

        // Paso 2: Verificar suficiencia de datos por categoría
        const availability = checkDataSufficiency(snapshot)

        if (availability.availableCategories.length === 0) {
          // Guardar registro de datos insuficientes (sin llamar a Claude)
          await supabaseAdmin.from('clinic_insights').insert({
            clinic_id: clinic.id,
            recommendations: [],
            data_snapshot: {
              ...snapshot,
              _insufficient_data: true,
              _available_categories: [],
            },
            model_used: 'none_insufficient_data',
          })
          results.push({ clinicId: clinic.id, status: 'skipped_insufficient_data' })
          continue
        }

        // Paso 3: Llamar a Claude API (solo con categorías suficientes)
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          temperature: 0.4,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: buildUserPrompt(
                clinic.name,
                snapshot as unknown as Record<string, unknown>,
                availability
              ),
            },
          ],
        })

        // Extraer texto de la respuesta
        const textBlock = response.content.find((b) => b.type === 'text')
        if (!textBlock || textBlock.type !== 'text') {
          results.push({ clinicId: clinic.id, status: 'error_no_text_response' })
          continue
        }

        // Parsear JSON (Claude puede envolver en ```json ... ```)
        let jsonStr = textBlock.text.trim()
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (fenceMatch) jsonStr = fenceMatch[1].trim()

        let recommendations: InsightRecommendation[]
        try {
          recommendations = JSON.parse(jsonStr)
          if (!Array.isArray(recommendations)) throw new Error('Not an array')
        } catch {
          console.error(`[Cron:Insights] JSON parse error for clinic ${clinic.id}:`, jsonStr.slice(0, 200))
          results.push({ clinicId: clinic.id, status: 'error_json_parse' })
          continue
        }

        // Validar estructura mínima + asegurar confidence
        recommendations = recommendations.filter((r) =>
          r.type && r.title && typeof r.impact_cop === 'number' && r.observation && r.action && r.module
        ).map((r) => ({
          ...r,
          confidence: ([1, 2, 3].includes(r.confidence) ? r.confidence : 2) as 1 | 2 | 3,
        })).slice(0, 5)

        if (recommendations.length === 0) {
          results.push({ clinicId: clinic.id, status: 'error_no_valid_recommendations' })
          continue
        }

        // Paso 4: Guardar en DB
        await supabaseAdmin.from('clinic_insights').insert({
          clinic_id: clinic.id,
          recommendations,
          data_snapshot: {
            ...snapshot,
            _available_categories: availability.availableCategories,
          },
          model_used: 'claude-sonnet-4-20250514',
        })

        results.push({
          clinicId: clinic.id,
          status: 'success',
          recommendations: recommendations.length,
        })
      } catch (err) {
        console.error(`[Cron:Insights] Error processing clinic ${clinic.id}:`, err)
        results.push({ clinicId: clinic.id, status: 'error' })
      }
    }

    return NextResponse.json({
      message: `Insights generados para ${results.filter((r) => r.status === 'success').length}/${clinics.length} clínicas`,
      results,
    })
  } catch (err) {
    console.error('[Cron:Insights] Fatal error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
