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
}

export async function getAnalyticsData(): Promise<AnalyticsData> {
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
  const [
    weekAppts,
    monthAppts,
    prevMonthAppts,
    allMonthAppts,
    carteraRes,
    newPatientsThis,
    newPatientsPrev,
    epsOverdue,
  ] = await Promise.all([
    // Citas de esta semana
    supabaseAdmin
      .from('appointments')
      .select('id, starts_at, status, payment_type, invoice_status, clinic_value, eps_value, patient_copago')
      .eq('clinic_id', clinicId)
      .gte('starts_at', weekStart.toISOString())
      .in('status', ['confirmed', 'completed', 'no_show', 'rescheduled']),

    // Citas del mes actual (completed + no_show)
    supabaseAdmin
      .from('appointments')
      .select('id, starts_at, status, payment_type, invoice_status, clinic_value, eps_value, patient_copago, outstanding_balance')
      .eq('clinic_id', clinicId)
      .gte('starts_at', monthStart.toISOString())
      .in('status', ['completed', 'no_show']),

    // Citas del mes anterior
    supabaseAdmin
      .from('appointments')
      .select('id, status, payment_type, clinic_value, eps_value, patient_copago')
      .eq('clinic_id', clinicId)
      .gte('starts_at', prevMonthStart.toISOString())
      .lte('starts_at', prevMonthEnd.toISOString())
      .in('status', ['completed', 'no_show']),

    // TODAS las citas del mes (para ocupación y franjas)
    supabaseAdmin
      .from('appointments')
      .select('id, starts_at, status, patient_id')
      .eq('clinic_id', clinicId)
      .gte('starts_at', monthStart.toISOString())
      .in('status', ['confirmed', 'completed', 'no_show', 'rescheduled']),

    // Cartera pendiente
    supabaseAdmin
      .from('cartera')
      .select('id, patient_id, amount, days_overdue, status')
      .eq('clinic_id', clinicId)
      .eq('status', 'pendiente'),

    // Pacientes nuevos este mes
    supabaseAdmin
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('created_at', monthStart.toISOString()),

    // Pacientes nuevos mes anterior
    supabaseAdmin
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('created_at', prevMonthStart.toISOString())
      .lte('created_at', prevMonthEnd.toISOString()),

    // Facturas EPS con >30 días
    supabaseAdmin
      .from('appointments')
      .select('id, eps_name, clinic_value, invoice_radication_date, invoice_status, glosa_value, patients(name, phone)')
      .eq('clinic_id', clinicId)
      .eq('payment_type', 'EPS')
      .in('invoice_status', ['en_tramite', 'glosada', 'vencida'])
      .not('invoice_radication_date', 'is', null)
      .order('invoice_radication_date', { ascending: true }),
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
  const { count: pendingCount } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('status', 'confirmed')
    .gte('starts_at', new Date().toISOString())

  return {
    week: {
      completadas: weekCompleted,
      agendadas: weekAgendadas,
      ingresos: weekIngresos,
      noShows: weekNoShows,
      costoPerdido: weekNoShows * price,
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
  }
}
