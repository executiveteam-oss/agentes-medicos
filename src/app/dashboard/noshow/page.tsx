// ============================================================
// PÁGINA NO-SHOWS — Análisis y control de inasistencias
// Ruta: /dashboard/noshow
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { getRestrictedDoctorId, isDoctorUnlinked } from '@/lib/doctor-filter'
import { DoctorUnlinkedBanner } from '@/components/dashboard/doctor-unlinked-banner'
import { formatTimeForPatient, formatCOP } from '@/lib/utils/dates'
import { NoShowCharts } from '@/components/dashboard/noshow-charts'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export const dynamic = 'force-dynamic'

const NO_SHOW_THRESHOLD = 25 // % umbral de alerta

export default async function NoShowPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorUnlinked(session)) return <DoctorUnlinkedBanner />

  const restrictDoctorId = getRestrictedDoctorId(session)

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('id, name, consultation_price')
    .eq('id', session.clinicId)
    .single()

  if (!clinic) {
    return (
      <div className="p-6 lg:p-8">
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">🏥</p>
          <p className="text-slate-900 font-medium">No hay clínica configurada</p>
        </div>
      </div>
    )
  }

  // Citas de los últimos 30 días
  const hace30 = new Date()
  hace30.setDate(hace30.getDate() - 30)

  let noshowQuery = supabaseAdmin
    .from('appointments')
    .select('id, starts_at, status, patients(name, phone, no_show_count, total_appointments)')
    .eq('clinic_id', clinic.id)
    .in('status', ['completed', 'no_show'])
    .gte('starts_at', hace30.toISOString())
    .order('starts_at', { ascending: false })

  if (restrictDoctorId) {
    noshowQuery = noshowQuery.eq('doctor_id', restrictDoctorId)
  }

  const { data: appointments } = await noshowQuery

  const total = appointments?.length ?? 0
  const noShows = (appointments ?? []).filter((a) => a.status === 'no_show').length
  const noShowRate = total > 0 ? Math.round((noShows / total) * 100) : 0
  const costoEstimado = noShows * (clinic.consultation_price ?? 0)

  // Agrupar por día de la semana
  const byDayOfWeek: Record<string, { noShows: number; completadas: number }> = {
    lun: { noShows: 0, completadas: 0 },
    mar: { noShows: 0, completadas: 0 },
    mié: { noShows: 0, completadas: 0 },
    jue: { noShows: 0, completadas: 0 },
    vie: { noShows: 0, completadas: 0 },
    sáb: { noShows: 0, completadas: 0 },
    dom: { noShows: 0, completadas: 0 },
  }

  const dayKeys = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  for (const apt of appointments ?? []) {
    const d = new Date(apt.starts_at)
    const key = dayKeys[d.getDay()]
    if (apt.status === 'no_show') byDayOfWeek[key].noShows++
    else byDayOfWeek[key].completadas++
  }

  const chartData = Object.entries(byDayOfWeek).map(([dia, data]) => ({
    dia,
    noShows: data.noShows,
    completadas: data.completadas,
    tasa: data.completadas + data.noShows > 0
      ? Math.round((data.noShows / (data.completadas + data.noShows)) * 100)
      : 0,
  }))

  // Pacientes con mayor riesgo (más de 1 no-show)
  const highRiskPatients = (appointments ?? [])
    .filter((a) => {
      const p = a.patients as unknown as { no_show_count: number; total_appointments: number } | null
      return p && p.no_show_count > 1
    })
    .map((a) => {
      const p = a.patients as unknown as { name: string; phone: string; no_show_count: number; total_appointments: number }
      return {
        id: a.id,
        name: p.name,
        phone: p.phone,
        no_show_count: p.no_show_count,
        total_appointments: p.total_appointments,
        last_no_show: a.starts_at,
        tasa: p.total_appointments > 0
          ? Math.round((p.no_show_count / p.total_appointments) * 100)
          : 0,
      }
    })
    .sort((a, b) => b.no_show_count - a.no_show_count)
    .slice(0, 10)

  const isAboveThreshold = noShowRate > NO_SHOW_THRESHOLD

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Análisis de No-Shows</h1>
        <p className="text-slate-500 text-sm">Últimos 30 días</p>
      </div>

      {/* Alerta si supera umbral */}
      {isAboveThreshold && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="text-red-800 text-sm font-semibold">Tasa de no-show en {noShowRate}%</p>
            <p className="text-red-700 text-sm mt-0.5">Supera el umbral de {NO_SHOW_THRESHOLD}%. Se recomienda activar recordatorios automáticos.</p>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total citas"
          value={String(total)}
          iconBg="bg-slate-100"
          iconColor="text-slate-600"
          icon={<CalendarIcon />}
        />
        <StatCard
          label="No-shows"
          value={String(noShows)}
          iconBg="bg-red-50"
          iconColor="text-red-600"
          icon={<XIcon />}
        />
        <StatCard
          label="Tasa no-show"
          value={`${noShowRate}%`}
          iconBg={isAboveThreshold ? 'bg-red-50' : 'bg-emerald-50'}
          iconColor={isAboveThreshold ? 'text-red-600' : 'text-emerald-600'}
          icon={<PercentIcon />}
        />
        <StatCard
          label="Costo estimado perdido"
          value={formatCOP(costoEstimado)}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          icon={<MoneyIcon />}
        />
      </div>

      {/* Chart + Threshold side by side on large screens */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Gráfico por día */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">No-shows por día de la semana</h2>
          <NoShowCharts data={chartData} />
          {/* Chart legend */}
          <div className="flex items-center gap-5 mt-4 pt-4 border-t border-slate-100">
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-3 h-3 rounded bg-teal-700" /> Completadas
            </span>
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-3 h-3 rounded bg-red-600" /> No-shows
            </span>
          </div>
        </div>

        {/* Threshold progress */}
        <div className="card p-5 flex flex-col">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Meta de no-show</h2>
          <p className="text-slate-500 text-xs mb-6">Mantener por debajo de {NO_SHOW_THRESHOLD}%</p>

          {/* Circular-ish large display */}
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className={`text-5xl font-bold ${isAboveThreshold ? 'text-red-600' : 'text-emerald-600'}`}>
              {noShowRate}%
            </div>
            <p className="text-slate-400 text-xs mt-2">tasa actual</p>
          </div>

          {/* Bar */}
          <div className="mt-6">
            <div className="flex justify-between text-xs text-slate-400 mb-1.5">
              <span>0%</span>
              <span className="font-medium text-slate-600">Meta: {NO_SHOW_THRESHOLD}%</span>
              <span>100%</span>
            </div>
            <div className="relative w-full bg-slate-100 rounded-full h-3">
              {/* Threshold marker */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10"
                style={{ left: `${NO_SHOW_THRESHOLD}%` }}
              />
              <div
                className={`h-3 rounded-full transition-all duration-500 ${isAboveThreshold ? 'bg-red-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(noShowRate, 100)}%` }}
              />
            </div>
            <p className={`text-xs mt-2 font-medium ${isAboveThreshold ? 'text-red-600' : 'text-emerald-600'}`}>
              {isAboveThreshold
                ? `${noShowRate - NO_SHOW_THRESHOLD}% por encima de la meta`
                : `${NO_SHOW_THRESHOLD - noShowRate}% por debajo de la meta`
              }
            </p>
          </div>
        </div>
      </div>

      {/* Tabla pacientes de riesgo */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Pacientes con mayor riesgo</h2>
          <p className="text-slate-400 text-xs mt-0.5">Ordenados por número de no-shows</p>
        </div>
        {highRiskPatients.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-3xl mb-3">🎉</p>
            <p className="text-slate-900 font-medium mb-1">Sin pacientes de alto riesgo</p>
            <p className="text-slate-500 text-sm">No hay pacientes con historial recurrente de no-shows</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Paciente</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">No-shows</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Total citas</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Tasa</th>
                  <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Último no-show</th>
                </tr>
              </thead>
              <tbody>
                {highRiskPatients.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-5 text-sm font-medium text-slate-900">{p.name}</td>
                    <td className="py-3.5 px-5">
                      <span className="badge badge-red">
                        {p.no_show_count}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 text-sm">{p.total_appointments}</td>
                    <td className="py-3.5 px-5">
                      <span className={`text-sm font-semibold ${
                        p.tasa > 40 ? 'text-red-600' : p.tasa > 20 ? 'text-amber-600' : 'text-emerald-600'
                      }`}>
                        {p.tasa}%
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-slate-500 text-sm">
                      {format(new Date(p.last_no_show), "d 'de' MMMM", { locale: es })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function StatCard({
  label,
  value,
  iconBg,
  iconColor,
  icon,
}: {
  label: string
  value: string
  iconBg: string
  iconColor: string
  icon: React.ReactNode
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center ${iconColor}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  )
}

function PercentIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" />
    </svg>
  )
}

function MoneyIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
