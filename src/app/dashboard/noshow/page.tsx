// ============================================================
// NO-SHOWS v2 — Analisis y control de inasistencias
// Ruta: /dashboard/noshow
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { getRestrictedDoctorId, isDoctorUnlinked } from '@/lib/doctor-filter'
import { DoctorUnlinkedBanner } from '@/components/dashboard/doctor-unlinked-banner'
import { redirect } from 'next/navigation'
import { NoShowDashboard } from '@/components/dashboard/noshow-v2'

export const dynamic = 'force-dynamic'

interface SearchParams {
  range?: string
}

export default async function NoShowPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorUnlinked(session)) return <DoctorUnlinkedBanner />

  const restrictDoctorId = getRestrictedDoctorId(session)
  const rangeDays = [7, 30, 90, 365].includes(Number(params.range)) ? Number(params.range) : 30

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('id, consultation_price, created_at')
    .eq('id', session.clinicId)
    .single()

  if (!clinic) {
    return (
      <div className="space-y-6">
        <div className="card-v2 p-12 text-center">
          <p className="text-4xl mb-4">🏥</p>
          <p className="text-lg font-semibold" style={{ color: 'var(--v2-text)' }}>No hay clinica configurada</p>
        </div>
      </div>
    )
  }

  // Consultation type prices for cost calculation
  const { data: ctData } = await supabaseAdmin
    .from('consultation_types')
    .select('id, price')
    .eq('clinic_id', clinic.id)
  const ctPrices: Record<string, number> = {}
  for (const ct of ctData ?? []) {
    if (ct.price) ctPrices[ct.id as string] = ct.price as number
  }
  const fallbackPrice = clinic.consultation_price ?? 0

  // ---- Current period ----
  const now = new Date()
  const currentStart = new Date(now)
  currentStart.setDate(currentStart.getDate() - rangeDays)

  // ---- Previous period (for comparison) ----
  const previousStart = new Date(currentStart)
  previousStart.setDate(previousStart.getDate() - rangeDays)

  // ---- Queries in parallel ----
  let currentQuery = supabaseAdmin
    .from('appointments')
    .select('id, starts_at, status, consultation_type_id, patients(name, phone, no_show_count, total_appointments)')
    .eq('clinic_id', clinic.id)
    .in('status', ['completed', 'no_show'])
    .gte('starts_at', currentStart.toISOString())
    .lte('starts_at', now.toISOString())
    .order('starts_at', { ascending: false })

  let previousQuery = supabaseAdmin
    .from('appointments')
    .select('id, status')
    .eq('clinic_id', clinic.id)
    .in('status', ['completed', 'no_show'])
    .gte('starts_at', previousStart.toISOString())
    .lt('starts_at', currentStart.toISOString())

  if (restrictDoctorId) {
    currentQuery = currentQuery.eq('doctor_id', restrictDoctorId)
    previousQuery = previousQuery.eq('doctor_id', restrictDoctorId)
  }

  const [currentRes, previousRes] = await Promise.all([currentQuery, previousQuery])

  const currentAppts = currentRes.data ?? []
  const previousAppts = previousRes.data ?? []

  // ---- Current period stats ----
  const currentTotal = currentAppts.length
  const currentNoShows = currentAppts.filter((a) => a.status === 'no_show')
  const currentNoShowCount = currentNoShows.length
  const currentRate = currentTotal > 0 ? Math.round((currentNoShowCount / currentTotal) * 100) : 0

  const costLost = currentNoShows.reduce((sum, a) => {
    const ctId = (a as Record<string, unknown>).consultation_type_id as string | null
    const price = (ctId && ctPrices[ctId]) ? ctPrices[ctId] : fallbackPrice
    return sum + price
  }, 0)

  // ---- By weekday ----
  const dayKeys = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
  const byWeekday = dayKeys.map((day) => ({ day, total: 0, noShows: 0, rate: 0 }))
  for (const apt of currentAppts) {
    const d = new Date(apt.starts_at as string)
    const idx = d.getDay()
    byWeekday[idx].total++
    if (apt.status === 'no_show') byWeekday[idx].noShows++
  }
  for (const wd of byWeekday) {
    wd.rate = wd.total > 0 ? Math.round((wd.noShows / wd.total) * 100) : 0
  }
  // Reorder: lun first
  const weekdayOrdered = [...byWeekday.slice(1), byWeekday[0]]

  // Worst day
  const worstDay = weekdayOrdered.reduce((worst, wd) => (wd.noShows > worst.noShows ? wd : worst), weekdayOrdered[0])

  // ---- Risk patients ----
  const riskMap = new Map<string, { name: string; phone: string; noShowCount: number; totalAppointments: number; lastNoShow: string }>()
  for (const a of currentNoShows) {
    const p = a.patients as unknown as { name: string; phone: string; no_show_count: number; total_appointments: number } | null
    if (!p) continue
    const existing = riskMap.get(p.phone)
    if (!existing || (a.starts_at as string) > existing.lastNoShow) {
      riskMap.set(p.phone, {
        name: p.name,
        phone: p.phone,
        noShowCount: p.no_show_count,
        totalAppointments: p.total_appointments,
        lastNoShow: a.starts_at as string,
      })
    }
  }
  const riskPatients = Array.from(riskMap.values())
    .filter((p) => p.noShowCount > 1)
    .map((p) => ({ ...p, rate: p.totalAppointments > 0 ? Math.round((p.noShowCount / p.totalAppointments) * 100) : 0 }))
    .sort((a, b) => b.noShowCount - a.noShowCount)
    .slice(0, 10)

  // ---- Previous period stats ----
  const previousTotal = previousAppts.length
  const previousNoShowCount = previousAppts.filter((a) => a.status === 'no_show').length
  const previousRate = previousTotal > 0 ? Math.round((previousNoShowCount / previousTotal) * 100) : 0
  const hasEnoughHistory = previousTotal >= 5

  const previous = hasEnoughHistory ? { totalAppointments: previousTotal, noShows: previousNoShowCount, rate: previousRate } : null
  const delta = previous ? currentRate - previous.rate : null

  // Chart data for Recharts
  const chartData = weekdayOrdered.map((wd) => ({
    dia: wd.day,
    completadas: wd.total - wd.noShows,
    noShows: wd.noShows,
    tasa: wd.rate,
  }))

  return (
    <NoShowDashboard
      rangeDays={rangeDays}
      currentRate={currentRate}
      currentTotal={currentTotal}
      currentNoShows={currentNoShowCount}
      costLost={costLost}
      delta={delta}
      previous={previous}
      hasEnoughHistory={hasEnoughHistory}
      worstDay={worstDay.day}
      worstDayRate={worstDay.rate}
      riskPatientsCount={riskPatients.length}
      riskPatients={riskPatients}
      chartData={chartData}
    />
  )
}
