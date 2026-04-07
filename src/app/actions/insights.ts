'use server'

// ============================================================
// Server Actions — Omuwan Insights
// Recolección de métricas + generación de recomendaciones IA
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'

// --- Tipos ---

export interface InsightRecommendation {
  type: 'OPORTUNIDAD' | 'ALERTA' | 'RIESGO' | 'LOGRO'
  title: string
  impact_cop: number
  observation: string
  action: string
  module: string
  confidence: 1 | 2 | 3
}

// Progreso por categoría de insight
export interface InsightCategoryProgress {
  key: string
  label: string
  icon: string
  current: number
  required: number
  ready: boolean
}

export interface InsightDataSufficiency {
  categories: InsightCategoryProgress[]
  anyReady: boolean
  allReady: boolean
}

export interface ClinicInsight {
  id: string
  clinic_id: string
  generated_at: string
  recommendations: InsightRecommendation[]
  is_read: boolean
  feedback: Record<string, 'up' | 'down'>
}

export interface ClinicDataSnapshot {
  clinic_name: string
  consultation_price: number
  total_appointments_90d: number
  occupancy_rate: number
  occupancy_by_day: Record<string, number>
  occupancy_by_slot: Record<string, number>
  no_show_rate: number
  no_show_by_doctor: Record<string, number>
  no_show_trend: 'improving' | 'worsening' | 'stable'
  cancellation_rate: number
  avg_cancellation_advance_hours: number
  waitlist_size: number
  patient_return_rate: number
  avg_days_between_visits: number
  patients_at_risk_count: number
  cartera_total: number
  cartera_avg_days_overdue: number
  revenue_actual: number
  revenue_potential: number
  nps_average: number | null
  least_used_slots: string[]
  top_consultation_types: string[]
  doctor_count: number
}

// --- Recolección de métricas ---

export async function buildClinicSnapshot(clinicId: string): Promise<ClinicDataSnapshot | null> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    clinicRes,
    aptsRes,
    recentAptsRes,
    doctorsRes,
    waitlistRes,
    carteraRes,
    patientsRes,
    npsRes,
    ctRes,
  ] = await Promise.all([
    supabaseAdmin.from('clinics').select('name, consultation_price, consultation_duration_minutes, working_hours').eq('id', clinicId).single(),
    supabaseAdmin.from('appointments').select('id, starts_at, status, doctor_id, payment_type, consultation_type_id, cancelled_at')
      .eq('clinic_id', clinicId).gte('starts_at', ninetyDaysAgo).in('status', ['completed', 'no_show', 'cancelled', 'confirmed', 'rescheduled']),
    supabaseAdmin.from('appointments').select('id, status')
      .eq('clinic_id', clinicId).gte('starts_at', thirtyDaysAgo).in('status', ['completed', 'no_show']),
    supabaseAdmin.from('doctors').select('id, name').eq('clinic_id', clinicId).eq('is_active', true),
    supabaseAdmin.from('waitlist').select('id').eq('clinic_id', clinicId).eq('status', 'waiting'),
    supabaseAdmin.from('cartera').select('amount, days_overdue').eq('clinic_id', clinicId).eq('status', 'pendiente'),
    supabaseAdmin.from('patients').select('id, total_appointments, visit_frequency_days')
      .eq('clinic_id', clinicId).gte('total_appointments', 1),
    supabaseAdmin.from('appointments').select('nps_score')
      .eq('clinic_id', clinicId).gte('starts_at', ninetyDaysAgo).not('nps_score', 'is', null),
    supabaseAdmin.from('consultation_types').select('id, name')
      .eq('clinic_id', clinicId).eq('is_active', true),
  ])

  const clinic = clinicRes.data
  if (!clinic) return null

  const apts = aptsRes.data ?? []
  const recentApts = recentAptsRes.data ?? []
  const doctors = doctorsRes.data ?? []
  const cartera = carteraRes.data ?? []
  const patients = patientsRes.data ?? []

  const price = clinic.consultation_price ?? 80000
  const totalApts = apts.length

  // Completed + no_show (for rates)
  const completedOrNoShow = apts.filter((a) => a.status === 'completed' || a.status === 'no_show')
  const completed = apts.filter((a) => a.status === 'completed')
  const noShows = apts.filter((a) => a.status === 'no_show')
  const cancelled = apts.filter((a) => a.status === 'cancelled')

  // No-show rate
  const noShowRate = completedOrNoShow.length > 0
    ? Math.round((noShows.length / completedOrNoShow.length) * 100)
    : 0

  // No-show trend (last 30 days vs previous 30 days)
  const recentCompleteOrNS = recentApts.filter((a) => a.status === 'completed' || a.status === 'no_show')
  const recentNoShows = recentApts.filter((a) => a.status === 'no_show')
  const recentRate = recentCompleteOrNS.length > 0
    ? (recentNoShows.length / recentCompleteOrNS.length) * 100
    : 0
  const noShowTrend: 'improving' | 'worsening' | 'stable' =
    recentRate < noShowRate - 3 ? 'improving'
      : recentRate > noShowRate + 3 ? 'worsening'
        : 'stable'

  // No-show by doctor
  const noShowByDoctor: Record<string, number> = {}
  for (const d of doctors) {
    const dApts = completedOrNoShow.filter((a) => a.doctor_id === d.id)
    const dNS = dApts.filter((a) => a.status === 'no_show')
    if (dApts.length > 0) {
      noShowByDoctor[d.name] = Math.round((dNS.length / dApts.length) * 100)
    }
  }

  // Cancellation rate + avg advance
  const cancellationRate = totalApts > 0
    ? Math.round((cancelled.length / totalApts) * 100)
    : 0

  let avgCancelAdvance = 0
  if (cancelled.length > 0) {
    let totalHours = 0
    let countWithData = 0
    for (const a of cancelled) {
      if (a.cancelled_at && a.starts_at) {
        const diff = (new Date(a.starts_at).getTime() - new Date(a.cancelled_at).getTime()) / (1000 * 60 * 60)
        if (diff > 0) { totalHours += diff; countWithData++ }
      }
    }
    avgCancelAdvance = countWithData > 0 ? Math.round(totalHours / countWithData) : 0
  }

  // Occupancy by day of week
  const dayNames = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  const dayCount: Record<string, number> = {}
  for (const a of apts.filter((a) => a.status !== 'cancelled')) {
    const d = new Date(a.starts_at)
    const cotDay = new Date(d.getTime() - 5 * 60 * 60 * 1000).getDay()
    const name = dayNames[cotDay]
    dayCount[name] = (dayCount[name] ?? 0) + 1
  }

  // Occupancy by time slot
  const slots: Record<string, number> = { '7-10am': 0, '10am-1pm': 0, '1-4pm': 0, '4-7pm': 0 }
  for (const a of apts.filter((a) => a.status !== 'cancelled')) {
    const d = new Date(a.starts_at)
    const h = new Date(d.getTime() - 5 * 60 * 60 * 1000).getHours()
    if (h >= 7 && h < 10) slots['7-10am']++
    else if (h >= 10 && h < 13) slots['10am-1pm']++
    else if (h >= 13 && h < 16) slots['1-4pm']++
    else if (h >= 16 && h < 19) slots['4-7pm']++
  }

  // Least used slots
  const slotEntries = Object.entries(slots).sort((a, b) => a[1] - b[1])
  const leastUsed = slotEntries.filter((s) => s[1] === slotEntries[0][1]).map((s) => s[0])

  // Occupancy rate estimate: apts used / 90 days * 6 working days * ~16 slots per day
  const estimatedSlots = 90 * (6 / 7) * Math.floor(10 * 60 / (clinic.consultation_duration_minutes ?? 30))
  const occupancyRate = estimatedSlots > 0
    ? Math.min(100, Math.round((apts.filter((a) => a.status !== 'cancelled').length / estimatedSlots) * 100))
    : 0

  // Patient return rate
  const withMultiple = patients.filter((p) => p.total_appointments >= 2).length
  const withAny = patients.length
  const returnRate = withAny > 0 ? Math.round((withMultiple / withAny) * 100) : 0

  // Avg days between visits for recurring patients
  const freqPatients = patients.filter((p) => p.visit_frequency_days && p.visit_frequency_days > 0)
  const avgDaysBetween = freqPatients.length > 0
    ? Math.round(freqPatients.reduce((sum, p) => sum + (p.visit_frequency_days ?? 0), 0) / freqPatients.length)
    : 0

  // At-risk patients
  const atRiskCount = patients.filter((p) =>
    p.visit_frequency_days && p.visit_frequency_days > 0 && p.total_appointments >= 2
  ).length // Simplified count — full calculation happens in analytics

  // Cartera
  const carteraTotal = cartera.reduce((sum, c) => sum + c.amount, 0)
  const carteraAvgDays = cartera.length > 0
    ? Math.round(cartera.reduce((sum, c) => sum + c.days_overdue, 0) / cartera.length)
    : 0

  // Revenue actual vs potential
  const revenueActual = completed.length * price
  const revenuePotential = (completed.length + noShows.length + cancelled.length) * price

  // NPS
  const npsScores = (npsRes.data ?? []).map((a) => (a as { nps_score: number }).nps_score).filter((s) => s != null)
  const npsAverage = npsScores.length > 0
    ? Math.round((npsScores.reduce((s, n) => s + n, 0) / npsScores.length) * 10) / 10
    : null

  // Top consultation types
  const ctCount: Record<string, number> = {}
  const ctNames: Record<string, string> = {}
  for (const ct of ctRes.data ?? []) { ctNames[ct.id] = ct.name }
  for (const a of apts) {
    if (a.consultation_type_id && ctNames[a.consultation_type_id]) {
      const name = ctNames[a.consultation_type_id]
      ctCount[name] = (ctCount[name] ?? 0) + 1
    }
  }
  const topCTs = Object.entries(ctCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name)

  return {
    clinic_name: clinic.name,
    consultation_price: price,
    total_appointments_90d: totalApts,
    occupancy_rate: occupancyRate,
    occupancy_by_day: dayCount,
    occupancy_by_slot: slots,
    no_show_rate: noShowRate,
    no_show_by_doctor: noShowByDoctor,
    no_show_trend: noShowTrend,
    cancellation_rate: cancellationRate,
    avg_cancellation_advance_hours: avgCancelAdvance,
    waitlist_size: (waitlistRes.data ?? []).length,
    patient_return_rate: returnRate,
    avg_days_between_visits: avgDaysBetween,
    patients_at_risk_count: atRiskCount,
    cartera_total: carteraTotal,
    cartera_avg_days_overdue: carteraAvgDays,
    revenue_actual: revenueActual,
    revenue_potential: revenuePotential,
    nps_average: npsAverage,
    least_used_slots: leastUsed,
    top_consultation_types: topCTs,
    doctor_count: doctors.length,
  }
}

// --- Acciones para la UI ---

export async function getLatestInsights(): Promise<ClinicInsight[]> {
  const clinicId = await checkReadPermission('analytics')

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabaseAdmin
    .from('clinic_insights')
    .select('id, clinic_id, generated_at, recommendations, is_read, feedback')
    .eq('clinic_id', clinicId)
    .gte('generated_at', sevenDaysAgo)
    .order('generated_at', { ascending: false })
    .limit(7)

  return (data ?? []).map((row) => ({
    id: row.id as string,
    clinic_id: row.clinic_id as string,
    generated_at: row.generated_at as string,
    recommendations: (row.recommendations ?? []) as InsightRecommendation[],
    is_read: (row.is_read ?? false) as boolean,
    feedback: ((row.feedback ?? {}) as Record<string, 'up' | 'down'>),
  }))
}

export async function getTodayInsight(): Promise<ClinicInsight | null> {
  const clinicId = await checkReadPermission('analytics')

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data } = await supabaseAdmin
    .from('clinic_insights')
    .select('id, clinic_id, generated_at, recommendations, is_read, feedback')
    .eq('clinic_id', clinicId)
    .gte('generated_at', todayStart.toISOString())
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id as string,
    clinic_id: data.clinic_id as string,
    generated_at: data.generated_at as string,
    recommendations: (data.recommendations ?? []) as InsightRecommendation[],
    is_read: (data.is_read ?? false) as boolean,
    feedback: ((data.feedback ?? {}) as Record<string, 'up' | 'down'>),
  }
}

export async function markInsightRead(insightId: string): Promise<void> {
  const clinicId = await checkReadPermission('analytics')
  await supabaseAdmin
    .from('clinic_insights')
    .update({ is_read: true })
    .eq('id', insightId)
    .eq('clinic_id', clinicId)
  revalidatePath('/dashboard/insights')
  revalidatePath('/dashboard')
}

export async function submitInsightFeedback(
  insightId: string,
  recommendationIndex: number,
  vote: 'up' | 'down'
): Promise<void> {
  const clinicId = await checkReadPermission('analytics')

  // Leer feedback actual
  const { data } = await supabaseAdmin
    .from('clinic_insights')
    .select('feedback')
    .eq('id', insightId)
    .eq('clinic_id', clinicId)
    .single()

  const currentFeedback = ((data?.feedback ?? {}) as Record<string, string>)
  currentFeedback[String(recommendationIndex)] = vote

  await supabaseAdmin
    .from('clinic_insights')
    .update({ feedback: currentFeedback })
    .eq('id', insightId)
    .eq('clinic_id', clinicId)
}

export async function getClinicAppointmentCount(): Promise<number> {
  const clinicId = await checkReadPermission('analytics')
  const { count } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .in('status', ['completed', 'no_show', 'confirmed', 'rescheduled'])
  return count ?? 0
}

export async function getUnreadInsightsCount(): Promise<number> {
  const clinicId = await checkReadPermission('analytics')

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { count } = await supabaseAdmin
    .from('clinic_insights')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('is_read', false)
    .gte('generated_at', todayStart.toISOString())

  return count ?? 0
}

// --- Suficiencia de datos por categoría ---

// Umbrales mínimos por categoría de insight
const DATA_THRESHOLDS = {
  noshow: { required: 20, label: 'No-shows', icon: '📊' },
  occupancy: { required: 21, label: 'Ocupación', icon: '⏰' }, // 21 días = 3 semanas
  retention: { required: 15, label: 'Retención', icon: '👥' },
  revenue: { required: 30, label: 'Ingresos', icon: '💰' },
  cartera: { required: 1, label: 'Cartera', icon: '💳' },
  reactivation: { required: 10, label: 'Reactivación', icon: '🔄' },
} as const

export async function getInsightDataSufficiency(): Promise<InsightDataSufficiency> {
  const clinicId = await checkReadPermission('analytics')
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [
    completedOrNoshowRes,
    uniquePatientsRes,
    aptsWithPriceRes,
    carteraRes,
    recurringPatientsRes,
    oldestAptRes,
  ] = await Promise.all([
    // No-shows: citas con status completed o no_show
    supabaseAdmin.from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('starts_at', ninetyDaysAgo)
      .in('status', ['completed', 'no_show']),
    // Retención: pacientes únicos con al menos 1 cita
    supabaseAdmin.from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('total_appointments', 1),
    // Ingresos: citas con datos de precio (completed)
    supabaseAdmin.from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('starts_at', ninetyDaysAgo)
      .in('status', ['completed', 'no_show', 'cancelled', 'confirmed', 'rescheduled']),
    // Cartera: entradas pendientes
    supabaseAdmin.from('cartera')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'pendiente'),
    // Reactivación: pacientes con 2+ citas
    supabaseAdmin.from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('total_appointments', 2),
    // Ocupación: cita más antigua para calcular semanas de datos
    supabaseAdmin.from('appointments')
      .select('starts_at')
      .eq('clinic_id', clinicId)
      .in('status', ['completed', 'no_show', 'confirmed', 'rescheduled'])
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  // Calcular días de datos para ocupación
  let daysOfData = 0
  if (oldestAptRes.data?.starts_at) {
    daysOfData = Math.floor(
      (Date.now() - new Date(oldestAptRes.data.starts_at as string).getTime()) / (1000 * 60 * 60 * 24)
    )
  }

  const categories: InsightCategoryProgress[] = [
    {
      key: 'noshow',
      label: DATA_THRESHOLDS.noshow.label,
      icon: DATA_THRESHOLDS.noshow.icon,
      current: completedOrNoshowRes.count ?? 0,
      required: DATA_THRESHOLDS.noshow.required,
      ready: (completedOrNoshowRes.count ?? 0) >= DATA_THRESHOLDS.noshow.required,
    },
    {
      key: 'retention',
      label: DATA_THRESHOLDS.retention.label,
      icon: DATA_THRESHOLDS.retention.icon,
      current: uniquePatientsRes.count ?? 0,
      required: DATA_THRESHOLDS.retention.required,
      ready: (uniquePatientsRes.count ?? 0) >= DATA_THRESHOLDS.retention.required,
    },
    {
      key: 'revenue',
      label: DATA_THRESHOLDS.revenue.label,
      icon: DATA_THRESHOLDS.revenue.icon,
      current: aptsWithPriceRes.count ?? 0,
      required: DATA_THRESHOLDS.revenue.required,
      ready: (aptsWithPriceRes.count ?? 0) >= DATA_THRESHOLDS.revenue.required,
    },
    {
      key: 'occupancy',
      label: DATA_THRESHOLDS.occupancy.label,
      icon: DATA_THRESHOLDS.occupancy.icon,
      current: Math.min(Math.floor(daysOfData / 7), 3), // semanas
      required: 3, // 3 semanas
      ready: daysOfData >= DATA_THRESHOLDS.occupancy.required,
    },
    {
      key: 'cartera',
      label: DATA_THRESHOLDS.cartera.label,
      icon: DATA_THRESHOLDS.cartera.icon,
      current: carteraRes.count ?? 0,
      required: DATA_THRESHOLDS.cartera.required,
      ready: (carteraRes.count ?? 0) >= DATA_THRESHOLDS.cartera.required,
    },
    {
      key: 'reactivation',
      label: DATA_THRESHOLDS.reactivation.label,
      icon: DATA_THRESHOLDS.reactivation.icon,
      current: recurringPatientsRes.count ?? 0,
      required: DATA_THRESHOLDS.reactivation.required,
      ready: (recurringPatientsRes.count ?? 0) >= DATA_THRESHOLDS.reactivation.required,
    },
  ]

  return {
    categories,
    anyReady: categories.some((c) => c.ready),
    allReady: categories.every((c) => c.ready),
  }
}
