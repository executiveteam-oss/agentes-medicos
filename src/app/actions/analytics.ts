'use server'

// ============================================================
// Server Actions — Analytics
// Todas las consultas filtradas por clinic_id del usuario
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission } from '@/lib/actions-helpers'

// --- Helpers de fechas ---

/** Inicio de la semana actual (lunes 00:00 COT → UTC) */
function startOfWeekCOT(): Date {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const day = now.getDay() // 0=dom
  const diff = day === 0 ? 6 : day - 1 // retroceder al lunes
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  return new Date(monday.getTime() + 5 * 60 * 60 * 1000) // COT→UTC
}

/** Inicio del mes actual (día 1 00:00 COT → UTC) */
function startOfMonthCOT(monthsAgo = 0): Date {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
  d.setHours(0, 0, 0, 0)
  return new Date(d.getTime() + 5 * 60 * 60 * 1000)
}

/** Fin del mes (último día 23:59 COT → UTC) */
function endOfMonthCOT(monthsAgo = 0): Date {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0)
  d.setHours(23, 59, 59, 999)
  return new Date(d.getTime() + 5 * 60 * 60 * 1000)
}

// --- Types ---

export interface WeekStats {
  completadas: number
  agendadas: number
  ingresos: number
  noShows: number
  costoPerdido: number
  peorFranja: string | null // ej: "Martes 2:00 PM"
}

export interface MonthComparison {
  actual: { citas: number; ingresos: number; noShowRate: number }
  anterior: { citas: number; ingresos: number; noShowRate: number }
}

export interface PaymentBreakdown {
  tipo: string
  cobrado: number
  pendiente: number
  total: number
}

export interface DayOccupation {
  dia: string
  citas: number
}

export interface TimeSlotDemand {
  franja: string
  citas: number
}

export interface TopPatient {
  id: string
  name: string
  phone: string
  count: number
}

export interface TopDebtor {
  id: string
  name: string
  phone: string
  amount: number
}

export interface EpsAlert {
  id: string
  eps_name: string
  clinic_value: number
  invoice_radication_date: string
  days_since: number
  invoice_status: string
  glosa_value: number
  patient_name: string
}

export interface LossCard {
  count: number
  amount: number
}

export interface LossValuation {
  noShows: LossCard
  cancellations: LossCard
  unbilled: LossCard
  total: number
}

export interface MonthTrend {
  month: string       // "Ene", "Feb", etc.
  real: number        // ingresos reales (completed)
  potencial: number   // ingresos potenciales (completed + no_show + cancelled)
}

export interface AtRiskPatient {
  id: string
  name: string
  phone: string
  visitFrequencyDays: number
  daysSinceLastVisit: number
}

export interface RetentionStats {
  recurringPatients: number       // Pacientes con 2+ visitas
  returnRate: number              // % que volvió tras primera visita
  atRiskCount: number             // Pacientes en riesgo (>freq×1.5)
  topAtRisk: AtRiskPatient[]      // Top 5 en riesgo
}

export interface AnalyticsData {
  week: WeekStats
  month: MonthComparison
  paymentBreakdown: PaymentBreakdown[]
  dayOccupation: DayOccupation[]
  timeSlots: TimeSlotDemand[]
  topLoyal: TopPatient[]
  topNoShow: TopPatient[]
  topDebtors: TopDebtor[]
  newPatientsThisMonth: number
  newPatientsPrevMonth: number
  epsAlerts: EpsAlert[]
  carteraVencida: number
  proyeccionIngresos: number
  consultationPrice: number
  npsAverage: number | null              // Promedio NPS del mes (1-10)
  npsCount: number                       // Respuestas NPS este mes
  inactivePatients: number               // Pacientes inactivos (>90 días sin cita)
  reactivatedThisMonth: number           // Pacientes reactivados este mes
  lossValuation: LossValuation
  monthTrend: MonthTrend[]
  retention: RetentionStats
}

export async function getAnalyticsData(doctorId?: string | null): Promise<AnalyticsData> {
  const clinicId = await checkReadPermission('analytics')

  const weekStart = startOfWeekCOT()
  const monthStart = startOfMonthCOT(0)
  const prevMonthStart = startOfMonthCOT(1)
  const prevMonthEnd = endOfMonthCOT(1)

  // Clinic info
  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('consultation_price')
    .eq('id', clinicId)
    .single()

  const price = clinic?.consultation_price ?? 80000

  // ==================== PARALLEL QUERIES ====================

  // Pre-build queries with doctor filter applied inline
  let q1 = supabaseAdmin.from('appointments')
    .select('id, starts_at, status, payment_type, invoice_status, clinic_value, eps_value, patient_copago, consultation_type_id')
    .eq('clinic_id', clinicId).gte('starts_at', weekStart.toISOString())
  if (doctorId) q1 = q1.eq('doctor_id', doctorId)

  let q2 = supabaseAdmin.from('appointments')
    .select('id, starts_at, status, payment_type, invoice_status, clinic_value, eps_value, patient_copago, outstanding_balance')
    .eq('clinic_id', clinicId).gte('starts_at', monthStart.toISOString())
  if (doctorId) q2 = q2.eq('doctor_id', doctorId)

  let q3 = supabaseAdmin.from('appointments')
    .select('id, status, payment_type, clinic_value, eps_value, patient_copago')
    .eq('clinic_id', clinicId).gte('starts_at', prevMonthStart.toISOString()).lte('starts_at', prevMonthEnd.toISOString())
  if (doctorId) q3 = q3.eq('doctor_id', doctorId)

  let q4 = supabaseAdmin.from('appointments')
    .select('id, starts_at, status, patient_id')
    .eq('clinic_id', clinicId).gte('starts_at', monthStart.toISOString())
  if (doctorId) q4 = q4.eq('doctor_id', doctorId)

  let q8 = supabaseAdmin.from('appointments')
    .select('id, eps_name, clinic_value, invoice_radication_date, invoice_status, glosa_value, patients(name, phone)')
    .eq('clinic_id', clinicId).eq('payment_type', 'EPS')
    .in('invoice_status', ['en_tramite', 'glosada', 'vencida'])
    .not('invoice_radication_date', 'is', null)
  if (doctorId) q8 = q8.eq('doctor_id', doctorId)

  let q9 = supabaseAdmin.from('appointments')
    .select('nps_score')
    .eq('clinic_id', clinicId).gte('starts_at', monthStart.toISOString())
  if (doctorId) q9 = q9.eq('doctor_id', doctorId)

  let q11 = supabaseAdmin.from('appointments')
    .select('id, consultation_type_id')
    .eq('clinic_id', clinicId).eq('status', 'cancelled').gte('starts_at', monthStart.toISOString())
  if (doctorId) q11 = q11.eq('doctor_id', doctorId)

  let q12 = supabaseAdmin.from('appointments')
    .select('id, consultation_type_id')
    .eq('clinic_id', clinicId).eq('status', 'no_show').gte('starts_at', monthStart.toISOString())
  if (doctorId) q12 = q12.eq('doctor_id', doctorId)

  let q13 = supabaseAdmin.from('appointments')
    .select('id, consultation_type_id')
    .eq('clinic_id', clinicId).eq('status', 'completed').is('invoice_number', null).gte('starts_at', monthStart.toISOString())
  if (doctorId) q13 = q13.eq('doctor_id', doctorId)

  let q15 = supabaseAdmin.from('appointments')
    .select('id, starts_at, status, consultation_type_id')
    .eq('clinic_id', clinicId).gte('starts_at', startOfMonthCOT(5).toISOString())
  if (doctorId) q15 = q15.eq('doctor_id', doctorId)

  const [
    weekAppts,
    monthAppts,
    prevMonthAppts,
    allMonthAppts,
    carteraRes,
    newPatientsThis,
    newPatientsPrev,
    epsOverdue,
    npsRes,
    reactivatedRes,
    cancelledMonthRes,
    noShowMonthRes,
    unbilledMonthRes,
    consultationTypesRes,
    trendRes,
  ] = await Promise.all([
    q1.in('status', ['confirmed', 'completed', 'no_show', 'rescheduled']),
    q2.in('status', ['completed', 'no_show']),
    q3.in('status', ['completed', 'no_show']),
    q4.in('status', ['confirmed', 'completed', 'no_show', 'rescheduled']),

    // Cartera pendiente (no filtrada por doctor — dato financiero)
    supabaseAdmin.from('cartera')
      .select('id, patient_id, amount, days_overdue, status')
      .eq('clinic_id', clinicId).eq('status', 'pendiente'),

    // Pacientes nuevos este mes
    supabaseAdmin.from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId).gte('created_at', monthStart.toISOString()),

    // Pacientes nuevos mes anterior
    supabaseAdmin.from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('created_at', prevMonthStart.toISOString())
      .lte('created_at', prevMonthEnd.toISOString()),

    q8.order('invoice_radication_date', { ascending: true }),
    q9.not('nps_score', 'is', null),

    // Pacientes reactivados este mes
    supabaseAdmin.from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId).gte('last_reactivation_sent', monthStart.toISOString()),

    q11,
    q12,
    q13,

    // Tipos de consulta
    supabaseAdmin.from('consultation_types')
      .select('id, price')
      .eq('clinic_id', clinicId).eq('is_active', true),

    q15.in('status', ['completed', 'no_show', 'cancelled']),
  ])

  const weekData = weekAppts.data ?? []
  const monthData = monthAppts.data ?? []
  const prevMonthData = prevMonthAppts.data ?? []
  const allMonth = allMonthAppts.data ?? []
  const cartera = carteraRes.data ?? []
  const epsData = epsOverdue.data ?? []

  // ==================== WEEK STATS ====================
  const weekCompleted = weekData.filter((a) => a.status === 'completed').length
  const weekAgendadas = weekData.length
  const weekNoShows = weekData.filter((a) => a.status === 'no_show').length

  let weekIngresos = 0
  for (const a of weekData.filter((a) => a.status === 'completed')) {
    if (a.payment_type === 'EPS') {
      weekIngresos += (a.patient_copago ?? 0)
    } else {
      weekIngresos += (a.clinic_value ?? price)
    }
  }

  // Peor franja de no-shows
  const noShowSlots: Record<string, number> = {}
  const dayNames = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  const dayNamesFull = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  for (const a of weekData.filter((a) => a.status === 'no_show')) {
    const d = new Date(a.starts_at)
    const cotHour = new Date(d.getTime() - 5 * 60 * 60 * 1000).getHours()
    const dayIdx = new Date(d.getTime() - 5 * 60 * 60 * 1000).getDay()
    const ampm = cotHour >= 12 ? 'PM' : 'AM'
    const h12 = cotHour > 12 ? cotHour - 12 : cotHour === 0 ? 12 : cotHour
    const key = `${dayNamesFull[dayIdx]} ${h12}:00 ${ampm}`
    noShowSlots[key] = (noShowSlots[key] ?? 0) + 1
  }
  let peorFranja: string | null = null
  let maxNoShow = 0
  for (const [slot, count] of Object.entries(noShowSlots)) {
    if (count > maxNoShow) { maxNoShow = count; peorFranja = `${slot} (${count})` }
  }

  // ==================== MONTH COMPARISON ====================
  function computeMonth(data: typeof monthData) {
    const completed = data.filter((a) => a.status === 'completed')
    const noShows = data.filter((a) => a.status === 'no_show')
    const total = completed.length + noShows.length
    let ingresos = 0
    for (const a of completed) {
      if (a.payment_type === 'EPS') {
        ingresos += ((a as { patient_copago?: number }).patient_copago ?? 0)
      } else {
        ingresos += ((a as { clinic_value?: number }).clinic_value ?? price)
      }
    }
    return {
      citas: completed.length,
      ingresos,
      noShowRate: total > 0 ? Math.round((noShows.length / total) * 100) : 0,
    }
  }

  // ==================== PAYMENT BREAKDOWN ====================
  const paymentMap: Record<string, { cobrado: number; pendiente: number }> = {}
  for (const a of monthData.filter((a) => a.status === 'completed')) {
    const tipo = a.payment_type ?? 'Particular'
    if (!paymentMap[tipo]) paymentMap[tipo] = { cobrado: 0, pendiente: 0 }

    const valor = a.clinic_value ?? price
    if (a.invoice_status === 'pagada' || a.invoice_status === 'emitida' || a.payment_type !== 'EPS') {
      paymentMap[tipo].cobrado += valor
    } else {
      paymentMap[tipo].pendiente += (a.outstanding_balance ?? valor)
    }
  }

  const paymentBreakdown: PaymentBreakdown[] = Object.entries(paymentMap).map(([tipo, v]) => ({
    tipo,
    cobrado: v.cobrado,
    pendiente: v.pendiente,
    total: v.cobrado + v.pendiente,
  }))

  // ==================== DAY OCCUPATION ====================
  const dayCount: Record<string, number> = {
    Lun: 0, Mar: 0, Mié: 0, Jue: 0, Vie: 0, Sáb: 0, Dom: 0,
  }
  const dayOrder = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  for (const a of allMonth) {
    const d = new Date(a.starts_at)
    const cotDay = new Date(d.getTime() - 5 * 60 * 60 * 1000).getDay()
    dayCount[dayOrder[cotDay]] = (dayCount[dayOrder[cotDay]] ?? 0) + 1
  }
  const dayOccupation: DayOccupation[] = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((dia) => ({
    dia,
    citas: dayCount[dia] ?? 0,
  }))

  // ==================== TIME SLOTS ====================
  let manana = 0, tarde = 0
  for (const a of allMonth) {
    const d = new Date(a.starts_at)
    const cotHour = new Date(d.getTime() - 5 * 60 * 60 * 1000).getHours()
    if (cotHour < 12) manana++
    else tarde++
  }

  // ==================== TOP PATIENTS ====================
  // Top loyal (más citas completadas este mes)
  const loyalCount: Record<string, number> = {}
  for (const a of allMonth.filter((a) => a.status === 'completed')) {
    loyalCount[a.patient_id] = (loyalCount[a.patient_id] ?? 0) + 1
  }
  const topLoyalIds = Object.entries(loyalCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  // Top no-show
  const noShowCount: Record<string, number> = {}
  for (const a of allMonth.filter((a) => a.status === 'no_show')) {
    noShowCount[a.patient_id] = (noShowCount[a.patient_id] ?? 0) + 1
  }
  const topNoShowIds = Object.entries(noShowCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  // Top debtors
  const debtMap: Record<string, number> = {}
  for (const c of cartera) {
    debtMap[c.patient_id] = (debtMap[c.patient_id] ?? 0) + c.amount
  }
  const topDebtorIds = Object.entries(debtMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  // Fetch patient names for all top lists
  const allTopIds = [
    ...topLoyalIds.map(([id]) => id),
    ...topNoShowIds.map(([id]) => id),
    ...topDebtorIds.map(([id]) => id),
  ]
  const uniqueIds = [...new Set(allTopIds)]
  let patientNames: Record<string, { name: string; phone: string }> = {}
  if (uniqueIds.length > 0) {
    const { data: pats } = await supabaseAdmin
      .from('patients')
      .select('id, name, phone')
      .in('id', uniqueIds)
    for (const p of pats ?? []) {
      patientNames[p.id] = { name: p.name, phone: p.phone }
    }
  }

  const topLoyal: TopPatient[] = topLoyalIds.map(([id, count]) => ({
    id,
    name: patientNames[id]?.name ?? 'Desconocido',
    phone: patientNames[id]?.phone ?? '',
    count,
  }))
  const topNoShow: TopPatient[] = topNoShowIds.map(([id, count]) => ({
    id,
    name: patientNames[id]?.name ?? 'Desconocido',
    phone: patientNames[id]?.phone ?? '',
    count,
  }))
  const topDebtors: TopDebtor[] = topDebtorIds.map(([id, amount]) => ({
    id,
    name: patientNames[id]?.name ?? 'Desconocido',
    phone: patientNames[id]?.phone ?? '',
    amount,
  }))

  // ==================== EPS ALERTS ====================
  const today = new Date()
  const epsAlerts: EpsAlert[] = epsData
    .map((a) => {
      const p = a.patients as unknown as { name: string; phone: string } | null
      const radDate = new Date(a.invoice_radication_date + 'T12:00:00')
      const daysSince = Math.floor((today.getTime() - radDate.getTime()) / (1000 * 60 * 60 * 24))
      return {
        id: a.id,
        eps_name: a.eps_name ?? 'EPS',
        clinic_value: a.clinic_value ?? 0,
        invoice_radication_date: a.invoice_radication_date,
        days_since: daysSince,
        invoice_status: a.invoice_status,
        glosa_value: a.glosa_value ?? 0,
        patient_name: p?.name ?? '-',
      }
    })
    .filter((a) => a.days_since > 30)
    .sort((a, b) => b.days_since - a.days_since)

  // Cartera vencida total
  const carteraVencida = cartera
    .filter((c) => c.days_overdue > 30)
    .reduce((sum, c) => sum + c.amount, 0)

  // Proyección: citas pendientes × tarifa
  let pendingQuery = supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('status', 'confirmed')
    .gte('starts_at', new Date().toISOString())
  if (doctorId) pendingQuery = pendingQuery.eq('doctor_id', doctorId)
  const { count: pendingCount } = await pendingQuery

  // NPS promedio del mes
  const npsScores = (npsRes.data ?? [])
    .map((a) => (a as { nps_score: number }).nps_score)
    .filter((s): s is number => s !== null && s !== undefined)
  const npsAverage = npsScores.length > 0
    ? Math.round((npsScores.reduce((sum, s) => sum + s, 0) / npsScores.length) * 10) / 10
    : null

  // Pacientes inactivos: sin cita completada en los últimos 90 días, con >=2 citas total
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: allActivePatients } = await supabaseAdmin
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .gte('total_appointments', 2)

  let inactiveCount = 0
  if (allActivePatients && allActivePatients.length > 0) {
    // Buscar cuáles tienen cita reciente
    let recentQuery = supabaseAdmin
      .from('appointments')
      .select('patient_id')
      .eq('clinic_id', clinicId)
      .eq('status', 'completed')
      .gte('starts_at', ninetyDaysAgo)
    if (doctorId) recentQuery = recentQuery.eq('doctor_id', doctorId)
    const { data: recentPatientIds } = await recentQuery

    const recentSet = new Set((recentPatientIds ?? []).map((r) => r.patient_id))
    inactiveCount = allActivePatients.filter((p) => !recentSet.has(p.id)).length
  }

  // ==================== RETENTION STATS ====================
  // Pacientes con 2+ visitas completadas (recurrentes)
  const [recurringRes, firstVisitRes, atRiskRes] = await Promise.all([
    supabaseAdmin
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('total_appointments', 2),
    // Pacientes con exactamente 1 cita (para calcular tasa de retorno)
    supabaseAdmin
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('total_appointments', 1),
    // Pacientes con frecuencia definida, para calcular riesgo
    supabaseAdmin
      .from('patients')
      .select('id, name, phone, visit_frequency_days')
      .eq('clinic_id', clinicId)
      .not('visit_frequency_days', 'is', null)
      .gte('total_appointments', 2),
  ])

  const recurringPatients = recurringRes.count ?? 0
  const totalWithVisits = firstVisitRes.count ?? 0
  const returnRate = totalWithVisits > 0
    ? Math.round((recurringPatients / totalWithVisits) * 100)
    : 0

  // Encontrar pacientes en riesgo: última visita > visit_frequency_days × 1.5
  const atRiskCandidates = atRiskRes.data ?? []
  const atRiskList: AtRiskPatient[] = []

  if (atRiskCandidates.length > 0) {
    const candidateIds = atRiskCandidates.map((p) => p.id)
    // Última cita completada por paciente
    let lastVisitsQuery = supabaseAdmin
      .from('appointments')
      .select('patient_id, starts_at')
      .eq('clinic_id', clinicId)
      .eq('status', 'completed')
      .in('patient_id', candidateIds)
      .order('starts_at', { ascending: false })
    if (doctorId) lastVisitsQuery = lastVisitsQuery.eq('doctor_id', doctorId)
    const { data: lastVisits } = await lastVisitsQuery

    // Agrupar: primera aparición = última cita (ya ordenadas desc)
    const lastVisitMap: Record<string, string> = {}
    for (const v of lastVisits ?? []) {
      if (!lastVisitMap[v.patient_id]) {
        lastVisitMap[v.patient_id] = v.starts_at
      }
    }

    for (const p of atRiskCandidates) {
      const lastVisitAt = lastVisitMap[p.id]
      if (!lastVisitAt || !p.visit_frequency_days) continue

      const daysSince = Math.floor(
        (Date.now() - new Date(lastVisitAt).getTime()) / (1000 * 60 * 60 * 24)
      )
      if (daysSince > p.visit_frequency_days * 1.5) {
        atRiskList.push({
          id: p.id,
          name: p.name,
          phone: p.phone,
          visitFrequencyDays: p.visit_frequency_days,
          daysSinceLastVisit: daysSince,
        })
      }
    }

    // Ordenar por más días sin visita y tomar top 5
    atRiskList.sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit)
  }

  const retention: RetentionStats = {
    recurringPatients,
    returnRate,
    atRiskCount: atRiskList.length,
    topAtRisk: atRiskList.slice(0, 5),
  }

  // ==================== LOSS VALUATION ====================
  const ctPrices: Record<string, number> = {}
  for (const ct of consultationTypesRes.data ?? []) {
    if (ct.price) ctPrices[ct.id] = ct.price
  }

  function appointmentPrice(apt: { consultation_type_id?: string | null }): number {
    if (apt.consultation_type_id && ctPrices[apt.consultation_type_id]) {
      return ctPrices[apt.consultation_type_id]
    }
    return price
  }

  const noShowsMonth = noShowMonthRes.data ?? []
  const cancelledMonth = cancelledMonthRes.data ?? []
  const unbilledMonth = unbilledMonthRes.data ?? []

  const noShowLoss = noShowsMonth.reduce((sum, a) => sum + appointmentPrice(a), 0)
  const cancelledLoss = cancelledMonth.reduce((sum, a) => sum + appointmentPrice(a), 0)
  const unbilledLoss = unbilledMonth.reduce((sum, a) => sum + appointmentPrice(a), 0)

  const lossValuation: LossValuation = {
    noShows: { count: noShowsMonth.length, amount: noShowLoss },
    cancellations: { count: cancelledMonth.length, amount: cancelledLoss },
    unbilled: { count: unbilledMonth.length, amount: unbilledLoss },
    total: noShowLoss + cancelledLoss + unbilledLoss,
  }

  // ==================== MONTH TREND (6 meses) ====================
  const trendData = trendRes.data ?? []
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const monthTrend: MonthTrend[] = []

  for (let i = 5; i >= 0; i--) {
    const mStart = startOfMonthCOT(i)
    const mEnd = endOfMonthCOT(i)
    const cotDate = new Date(mStart.getTime() - 5 * 60 * 60 * 1000)
    const label = monthNames[cotDate.getMonth()]

    let real = 0
    let potencial = 0
    for (const a of trendData) {
      const d = new Date(a.starts_at)
      if (d >= mStart && d <= mEnd) {
        const p = appointmentPrice(a)
        if (a.status === 'completed') {
          real += p
          potencial += p
        } else {
          // no_show or cancelled
          potencial += p
        }
      }
    }
    monthTrend.push({ month: label, real, potencial })
  }

  return {
    week: {
      completadas: weekCompleted,
      agendadas: weekAgendadas,
      ingresos: weekIngresos,
      noShows: weekNoShows,
      costoPerdido: weekData.filter((a) => a.status === 'no_show').reduce((sum, a) => sum + appointmentPrice(a), 0),
      peorFranja,
    },
    month: {
      actual: computeMonth(monthData),
      anterior: computeMonth(prevMonthData as typeof monthData),
    },
    paymentBreakdown,
    dayOccupation,
    timeSlots: [
      { franja: 'Mañana (7-12)', citas: manana },
      { franja: 'Tarde (12-6)', citas: tarde },
    ],
    topLoyal,
    topNoShow,
    topDebtors,
    newPatientsThisMonth: newPatientsThis.count ?? 0,
    newPatientsPrevMonth: newPatientsPrev.count ?? 0,
    epsAlerts,
    carteraVencida,
    proyeccionIngresos: (pendingCount ?? 0) * price,
    consultationPrice: price,
    npsAverage,
    npsCount: npsScores.length,
    inactivePatients: inactiveCount,
    reactivatedThisMonth: reactivatedRes.count ?? 0,
    lossValuation,
    monthTrend,
    retention,
  }
}
