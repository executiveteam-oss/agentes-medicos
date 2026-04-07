// Generate insights directly for Los Puchis clinic
// Calls buildClinicSnapshot + Claude API same as the cron job

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const sb = createClient(
  'https://rftbdhhbiyyoentvorqk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdGJkaGhiaXl5b2VudHZvcnFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAwMTk1MSwiZXhwIjoyMDg2NTc3OTUxfQ.Yt0Oole2-We-KzP5J7jDmii8ABGasejYXxsr097NHxY'
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
})
const CID = 'e7cc72ca-30d1-4b59-bebc-e340c09f3507'

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
- Compara SIEMPRE con el benchmark relevante
- Cuantifica SIEMPRE el impacto en COP
- Sé ESPECÍFICO sobre el día/hora/médico/tipo cuando los datos lo permiten
- Da UNA acción concreta, no una lista
- Menciona el tiempo esperado para ver resultados
- Si algo está bien, dilo con el benchmark
- NUNCA generes un insight si los datos no lo respaldan claramente`

async function buildSnapshot() {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [clinicRes, aptsRes, recentAptsRes, doctorsRes, waitlistRes, carteraRes, patientsRes, npsRes] = await Promise.all([
    sb.from('clinics').select('name, consultation_price, consultation_duration_minutes, working_hours').eq('id', CID).single(),
    sb.from('appointments').select('id, starts_at, status, doctor_id, payment_type, consultation_type_id, cancelled_at')
      .eq('clinic_id', CID).gte('starts_at', ninetyDaysAgo).in('status', ['completed', 'no_show', 'cancelled', 'confirmed', 'rescheduled']),
    sb.from('appointments').select('id, status').eq('clinic_id', CID).gte('starts_at', thirtyDaysAgo).in('status', ['completed', 'no_show']),
    sb.from('doctors').select('id, name').eq('clinic_id', CID).eq('is_active', true),
    sb.from('waitlist').select('id').eq('clinic_id', CID).eq('status', 'waiting'),
    sb.from('cartera').select('amount, days_overdue').eq('clinic_id', CID).eq('status', 'pendiente'),
    sb.from('patients').select('id, total_appointments, visit_frequency_days').eq('clinic_id', CID).gte('total_appointments', 1),
    sb.from('appointments').select('nps_score').eq('clinic_id', CID).gte('starts_at', ninetyDaysAgo).not('nps_score', 'is', null),
  ])

  const clinic = clinicRes.data
  if (!clinic) return null

  const apts = aptsRes.data ?? []
  const recentApts = recentAptsRes.data ?? []
  const doctors = doctorsRes.data ?? []
  const cartera = carteraRes.data ?? []
  const patients = patientsRes.data ?? []
  const price = clinic.consultation_price ?? 120000

  const completedOrNoShow = apts.filter(a => a.status === 'completed' || a.status === 'no_show')
  const completed = apts.filter(a => a.status === 'completed')
  const noShows = apts.filter(a => a.status === 'no_show')
  const cancelled = apts.filter(a => a.status === 'cancelled')

  const noShowRate = completedOrNoShow.length > 0 ? Math.round((noShows.length / completedOrNoShow.length) * 100) : 0

  // Day of week breakdown
  const dayNames = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  const dayCount: Record<string, number> = {}
  for (const a of apts.filter(a => a.status !== 'cancelled')) {
    const d = new Date(a.starts_at)
    const cotDay = new Date(d.getTime() - 5 * 60 * 60 * 1000).getDay()
    dayCount[dayNames[cotDay]] = (dayCount[dayNames[cotDay]] ?? 0) + 1
  }

  // No-show by doctor
  const noShowByDoctor: Record<string, number> = {}
  for (const d of doctors) {
    const dApts = completedOrNoShow.filter(a => a.doctor_id === d.id)
    const dNS = dApts.filter(a => a.status === 'no_show')
    if (dApts.length > 0) noShowByDoctor[d.name] = Math.round((dNS.length / dApts.length) * 100)
  }

  // Slots
  const slots: Record<string, number> = { '7-10am': 0, '10am-1pm': 0, '1-4pm': 0, '4-7pm': 0 }
  for (const a of apts.filter(a => a.status !== 'cancelled')) {
    const h = new Date(new Date(a.starts_at).getTime() - 5 * 60 * 60 * 1000).getHours()
    if (h >= 7 && h < 10) slots['7-10am']++
    else if (h >= 10 && h < 13) slots['10am-1pm']++
    else if (h >= 13 && h < 16) slots['1-4pm']++
    else if (h >= 16 && h < 19) slots['4-7pm']++
  }

  const estimatedSlots = 90 * (6 / 7) * Math.floor(10 * 60 / (clinic.consultation_duration_minutes ?? 30))
  const occupancyRate = estimatedSlots > 0 ? Math.min(100, Math.round((apts.filter(a => a.status !== 'cancelled').length / estimatedSlots) * 100)) : 0

  const withMultiple = patients.filter(p => p.total_appointments >= 2).length
  const returnRate = patients.length > 0 ? Math.round((withMultiple / patients.length) * 100) : 0

  const carteraTotal = cartera.reduce((s, c) => s + c.amount, 0)
  const carteraAvgDays = cartera.length > 0 ? Math.round(cartera.reduce((s, c) => s + c.days_overdue, 0) / cartera.length) : 0

  const npsScores = (npsRes.data ?? []).map(a => (a as { nps_score: number }).nps_score).filter(s => s != null)
  const npsAvg = npsScores.length > 0 ? Math.round((npsScores.reduce((s, n) => s + n, 0) / npsScores.length) * 10) / 10 : null

  // No-show by day for insight
  const noShowByDay: Record<string, number> = {}
  for (const a of completedOrNoShow) {
    const d = new Date(a.starts_at)
    const cotDay = new Date(d.getTime() - 5 * 60 * 60 * 1000).getDay()
    const name = dayNames[cotDay]
    if (a.status === 'no_show') {
      const dayApts = completedOrNoShow.filter(x => {
        const xd = new Date(x.starts_at)
        return new Date(xd.getTime() - 5 * 60 * 60 * 1000).getDay() === cotDay
      })
      const dayNS = dayApts.filter(x => x.status === 'no_show')
      noShowByDay[name] = Math.round((dayNS.length / dayApts.length) * 100)
    }
  }

  // Unbilled appointments
  const { count: unbilledCount } = await sb.from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', CID)
    .eq('status', 'completed')
    .is('invoice_number', null)

  return {
    clinic_name: clinic.name,
    consultation_price: price,
    total_appointments_90d: apts.length,
    occupancy_rate: occupancyRate,
    occupancy_by_day: dayCount,
    occupancy_by_slot: slots,
    no_show_rate: noShowRate,
    no_show_by_doctor: noShowByDoctor,
    no_show_by_day: noShowByDay,
    no_show_trend: 'stable' as const,
    cancellation_rate: apts.length > 0 ? Math.round((cancelled.length / apts.length) * 100) : 0,
    avg_cancellation_advance_hours: 0,
    waitlist_size: (waitlistRes.data ?? []).length,
    patient_return_rate: returnRate,
    avg_days_between_visits: 0,
    patients_at_risk_count: patients.filter(p => p.total_appointments === 1).length,
    patients_inactive_90d: patients.filter(p => p.total_appointments === 1).length,
    cartera_total: carteraTotal,
    cartera_avg_days_overdue: carteraAvgDays,
    revenue_actual: completed.length * price,
    revenue_potential: (completed.length + noShows.length + cancelled.length) * price,
    nps_average: npsAvg,
    nps_scores_detail: npsScores,
    unbilled_appointments: unbilledCount ?? 0,
    least_used_slots: Object.entries(slots).sort((a, b) => a[1] - b[1]).slice(0, 2).map(s => s[0]),
    top_consultation_types: [],
    doctor_count: doctors.length,
  }
}

async function main() {
  console.log('🧠 Building clinic snapshot...\n')
  const snapshot = await buildSnapshot()
  if (!snapshot) { console.error('No snapshot'); return }

  console.log('Snapshot summary:')
  console.log(`  Appointments (90d): ${snapshot.total_appointments_90d}`)
  console.log(`  No-show rate: ${snapshot.no_show_rate}%`)
  console.log(`  No-show by day: ${JSON.stringify(snapshot.no_show_by_day)}`)
  console.log(`  Occupancy: ${snapshot.occupancy_rate}%`)
  console.log(`  Cartera: $${snapshot.cartera_total} (avg ${snapshot.cartera_avg_days_overdue} days)`)
  console.log(`  Return rate: ${snapshot.patient_return_rate}%`)
  console.log(`  Unbilled: ${snapshot.unbilled_appointments}`)
  console.log(`  NPS: ${snapshot.nps_average} (scores: ${snapshot.nps_scores_detail})`)
  console.log(`  Revenue actual: $${snapshot.revenue_actual}`)
  console.log(`  Revenue potential: $${snapshot.revenue_potential}`)

  // Delete any existing today's insight
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  await sb.from('clinic_insights')
    .delete()
    .eq('clinic_id', CID)
    .gte('generated_at', todayStart.toISOString())

  console.log('\n🤖 Calling Claude API...\n')

  const userPrompt = `Analyze this clinic's data and generate 3-5 prioritized recommendations.
ONLY generate insights for categories where data is available.

CLINIC: ${snapshot.clinic_name}

DATA AVAILABILITY:
- No-show analysis: SUFFICIENT data (include no-show insights)
- Occupancy analysis: SUFFICIENT data (include schedule optimization insights)
- Patient retention: SUFFICIENT data (include retention insights)
- Revenue analysis: SUFFICIENT data (include revenue insights)
- Cartera/debt: HAS pending debt (include debt collection insights)
- Patient reactivation: SUFFICIENT data (include reactivation insights)

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
- 1 = based on limited data, indicative only
- 2 = based on solid data, reliable
- 3 = based on extensive data, high confidence

IMPORTANT:
- At least 1 must be type "OPORTUNIDAD"
- If no_show_rate > 15%, include an "ALERTA" about it — compare to benchmark
- If cartera_total > 0, include a "RIESGO" about overdue payments
- If there's something genuinely good vs benchmarks, include a "LOGRO"
- impact_cop must be realistic based on consultation_price ($120.000) and volumes
- ALWAYS reference the specific benchmark number in your observation
- Sort by impact_cop descending`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    temperature: 0.4,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') { console.error('No text response'); return }

  let jsonStr = textBlock.text.trim()
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) jsonStr = fenceMatch[1].trim()

  console.log('Raw response:\n', jsonStr.slice(0, 200), '...\n')

  const recommendations = JSON.parse(jsonStr)

  // Save to DB
  const { error } = await sb.from('clinic_insights').insert({
    clinic_id: CID,
    recommendations,
    data_snapshot: snapshot,
    model_used: 'claude-sonnet-4-20250514',
    is_read: false,
    feedback: {},
  })

  if (error) { console.error('Insert error:', error); return }

  console.log('✅ Insights saved!\n')
  console.log('=' .repeat(60))
  console.log('GENERATED INSIGHTS:')
  console.log('=' .repeat(60))

  for (const [i, rec] of recommendations.entries()) {
    console.log(`\n--- #${i + 1} ---`)
    console.log(`Type: ${rec.type}`)
    console.log(`Title: ${rec.title}`)
    console.log(`Impact: $${rec.impact_cop?.toLocaleString('es-CO')} COP`)
    console.log(`Confidence: ${rec.confidence}/3`)
    console.log(`Observation: ${rec.observation}`)
    console.log(`Action: ${rec.action}`)
    console.log(`Module: ${rec.module}`)
  }
}

main().catch(console.error)
