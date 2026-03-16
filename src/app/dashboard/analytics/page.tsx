// ============================================================
// Estadísticas y analíticas — 4 secciones
// Ruta: /dashboard/analytics
// ============================================================

export const dynamic = 'force-dynamic'

import { getAnalyticsData } from '@/app/actions/analytics'
import { formatCOP, formatPhone } from '@/lib/utils/dates'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Link from 'next/link'
import {
  DayOccupationChart,
  TimeSlotsChart,
  PaymentBreakdownChart,
} from '@/components/dashboard/analytics-charts'

export default async function AnalyticsPage() {
  const data = await getAnalyticsData()
  const { week, month } = data

  // Helpers para comparar vs mes anterior
  const citasDelta = month.actual.citas - month.anterior.citas
  const ingresosDelta = month.actual.ingresos - month.anterior.ingresos
  const noShowDelta = month.actual.noShowRate - month.anterior.noShowRate

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Estadísticas</h1>
        <p className="text-slate-500 text-sm">Métricas del consultorio en tiempo real</p>
      </div>

      {/* ==================== SECCIÓN 1: ESTA SEMANA ==================== */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Esta semana</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Completadas / Agendadas"
            value={`${week.completadas} / ${week.agendadas}`}
          />
          <StatCard
            label="Ingresos"
            value={formatCOP(week.ingresos)}
            valueClass="text-teal-700"
          />
          <StatCard
            label="No-shows"
            value={String(week.noShows)}
            sub={week.costoPerdido > 0 ? `${formatCOP(week.costoPerdido)} perdido` : undefined}
            valueClass={week.noShows > 0 ? 'text-red-600' : undefined}
          />
          <StatCard
            label="Peor franja"
            value={week.peorFranja ?? 'Sin no-shows'}
            valueClass={week.peorFranja ? 'text-amber-600' : 'text-slate-400'}
            small
          />
        </div>
      </section>

      {/* ==================== SECCIÓN 2: ESTE MES ==================== */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Este mes vs anterior</h2>

        {/* Comparison cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <ComparisonCard
            label="Citas completadas"
            actual={String(month.actual.citas)}
            delta={citasDelta}
            positive={citasDelta >= 0}
          />
          <ComparisonCard
            label="Ingresos"
            actual={formatCOP(month.actual.ingresos)}
            delta={ingresosDelta}
            positive={ingresosDelta >= 0}
            formatDelta={(d) => formatCOP(Math.abs(d))}
          />
          <ComparisonCard
            label="Tasa no-show"
            actual={`${month.actual.noShowRate}%`}
            delta={noShowDelta}
            positive={noShowDelta <= 0}
            suffix="%"
            invertColor
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card p-5 lg:col-span-1">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Ocupación por día</h3>
            <DayOccupationChart data={data.dayOccupation} />
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Demanda por franja</h3>
            <TimeSlotsChart data={data.timeSlots} />
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Ingresos por tipo de pago</h3>
            <PaymentBreakdownChart data={data.paymentBreakdown} />
          </div>
        </div>
      </section>

      {/* ==================== SECCIÓN 3: MIS PACIENTES ==================== */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Mis pacientes</h2>

        {/* Pacientes nuevos */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Pacientes nuevos (este mes)"
            value={String(data.newPatientsThisMonth)}
            valueClass="text-teal-700"
          />
          <StatCard
            label="Pacientes nuevos (mes anterior)"
            value={String(data.newPatientsPrevMonth)}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Top leales */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Top pacientes leales</h3>
            </div>
            {data.topLoyal.length === 0 ? (
              <EmptyList text="Sin datos este mes" />
            ) : (
              <div className="divide-y divide-slate-100">
                {data.topLoyal.map((p, i) => (
                  <PatientRow key={p.id} rank={i + 1} name={p.name} phone={p.phone} id={p.id}>
                    <span className="badge badge-green">{p.count} citas</span>
                  </PatientRow>
                ))}
              </div>
            )}
          </div>

          {/* Top no-show */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Top no-show</h3>
            </div>
            {data.topNoShow.length === 0 ? (
              <EmptyList text="Sin no-shows este mes" />
            ) : (
              <div className="divide-y divide-slate-100">
                {data.topNoShow.map((p, i) => (
                  <PatientRow key={p.id} rank={i + 1} name={p.name} phone={p.phone} id={p.id}>
                    <span className="badge badge-red">{p.count} faltas</span>
                  </PatientRow>
                ))}
              </div>
            )}
          </div>

          {/* Top deudores */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Top deudores</h3>
            </div>
            {data.topDebtors.length === 0 ? (
              <EmptyList text="Sin saldos pendientes" />
            ) : (
              <div className="divide-y divide-slate-100">
                {data.topDebtors.map((p, i) => (
                  <PatientRow key={p.id} rank={i + 1} name={p.name} phone={p.phone} id={p.id}>
                    <span className="text-sm font-semibold text-red-600">{formatCOP(p.amount)}</span>
                  </PatientRow>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ==================== SECCIÓN 4: ALERTAS FINANCIERAS ==================== */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Alertas financieras</h2>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Cartera vencida (+30 días)"
            value={data.carteraVencida > 0 ? formatCOP(data.carteraVencida) : '$0'}
            valueClass={data.carteraVencida > 0 ? 'text-red-600' : undefined}
          />
          <StatCard
            label="Proyección ingresos"
            value={formatCOP(data.proyeccionIngresos)}
            sub={`${Math.round(data.proyeccionIngresos / (data.consultationPrice || 80000))} citas pendientes`}
            valueClass="text-teal-700"
          />
          <StatCard
            label="EPS por cobrar (+30 días)"
            value={`${data.epsAlerts.length} facturas`}
            valueClass={data.epsAlerts.length > 0 ? 'text-amber-600' : undefined}
          />
        </div>

        {/* EPS Alerts table */}
        {data.epsAlerts.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Facturas EPS pendientes (+30 días)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Paciente</th>
                    <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">EPS</th>
                    <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Valor</th>
                    <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Radicada</th>
                    <th className="text-center py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Días</th>
                    <th className="text-left py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Estado</th>
                    <th className="text-right py-3 px-5 text-xs font-medium uppercase tracking-wider text-slate-500">Glosa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.epsAlerts.map((a) => {
                    const statusClass =
                      a.invoice_status === 'glosada' ? 'badge-red'
                        : a.invoice_status === 'vencida' ? 'badge-red'
                          : 'badge-amber'
                    const statusLabel =
                      a.invoice_status === 'glosada' ? 'Glosada'
                        : a.invoice_status === 'vencida' ? 'Vencida'
                          : 'En trámite'
                    return (
                      <tr key={a.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-5 text-sm text-slate-900">{a.patient_name}</td>
                        <td className="py-3 px-5">
                          <span className="badge badge-blue">{a.eps_name}</span>
                        </td>
                        <td className="py-3 px-5 text-right text-sm font-semibold text-slate-900">{formatCOP(a.clinic_value)}</td>
                        <td className="py-3 px-5 text-sm text-slate-500">
                          {format(new Date(a.invoice_radication_date + 'T12:00:00'), "d MMM yyyy", { locale: es })}
                        </td>
                        <td className="py-3 px-5 text-center">
                          <span className={`badge ${a.days_since > 60 ? 'badge-red' : 'badge-amber'}`}>
                            {a.days_since}d
                          </span>
                        </td>
                        <td className="py-3 px-5">
                          <span className={`badge ${statusClass}`}>{statusLabel}</span>
                        </td>
                        <td className="py-3 px-5 text-right text-sm">
                          {a.glosa_value > 0 ? (
                            <span className="font-semibold text-red-600">{formatCOP(a.glosa_value)}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function StatCard({
  label,
  value,
  sub,
  valueClass,
  small,
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
  small?: boolean
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      <p className={`${small ? 'text-base' : 'text-lg'} font-semibold ${valueClass ?? 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function ComparisonCard({
  label,
  actual,
  delta,
  positive,
  suffix,
  invertColor,
  formatDelta,
}: {
  label: string
  actual: string
  delta: number
  positive: boolean
  suffix?: string
  invertColor?: boolean
  formatDelta?: (d: number) => string
}) {
  const color = positive
    ? (invertColor ? 'text-teal-600' : 'text-teal-600')
    : (invertColor ? 'text-red-600' : 'text-red-600')
  const arrow = delta > 0 ? '+' : delta < 0 ? '-' : ''
  const displayDelta = formatDelta
    ? `${delta >= 0 ? '+' : '-'}${formatDelta(delta)}`
    : `${arrow}${Math.abs(delta)}${suffix ?? ''}`

  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{actual}</p>
      {delta !== 0 && (
        <p className={`text-xs font-medium mt-0.5 ${color}`}>
          {displayDelta} vs mes anterior
        </p>
      )}
    </div>
  )
}

function PatientRow({
  rank,
  name,
  phone,
  id,
  children,
}: {
  rank: number
  name: string
  phone: string
  id: string
  children: React.ReactNode
}) {
  return (
    <div className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs font-semibold text-slate-400 w-4">{rank}</span>
        <div className="min-w-0">
          <Link
            href={`/dashboard/patients/${id}`}
            className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline truncate block"
          >
            {name}
          </Link>
          <p className="text-xs text-slate-400">{formatPhone(phone)}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function EmptyList({ text }: { text: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-slate-400 text-sm">{text}</p>
    </div>
  )
}
