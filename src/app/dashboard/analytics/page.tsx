// ============================================================
// Estadísticas y analíticas — 4 secciones
// Ruta: /dashboard/analytics
// ============================================================

export const dynamic = 'force-dynamic'

import { getAnalyticsData } from '@/app/actions/analytics'
import { getEpsProfitability } from '@/app/actions/glosas'
import { getUserSession } from '@/lib/session'
import { getRestrictedDoctorId, isDoctorUnlinked } from '@/lib/doctor-filter'
import { DoctorUnlinkedBanner } from '@/components/dashboard/doctor-unlinked-banner'
import { formatCOP, formatPhone } from '@/lib/utils/dates'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  DayOccupationChart,
  TimeSlotsChart,
  PaymentBreakdownChart,
  LossValuationChart,
  EpsProfitabilityChart,
} from '@/components/dashboard/analytics-charts'
import { ReactivationButton } from '@/components/dashboard/reactivation-button'
import { getFeatureGate, isFeatureEnabled } from '@/lib/feature-gate'
import { FeatureLocked } from '@/components/dashboard/feature-locked'

export default async function AnalyticsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorUnlinked(session)) return <DoctorUnlinkedBanner />

  const gate = await getFeatureGate(session.clinicId)
  if (!isFeatureEnabled(gate.config, 'estadisticas')) {
    return (
      <FeatureLocked
        featureName="Estadísticas avanzadas"
        featureDescription="Métricas detalladas de ocupación, no-shows, ingresos y rendimiento por médico."
        whatsappMessage="quiero activar Estadísticas avanzadas"
        clinicName={session.clinic?.name}
        plusModuleName="Estadísticas avanzadas"
        doctorCount={gate.expectedDoctors}
      />
    )
  }

  const restrictDoctorId = getRestrictedDoctorId(session)

  const [data, epsProfitability] = await Promise.all([
    getAnalyticsData(restrictDoctorId),
    getEpsProfitability(restrictDoctorId),
  ])
  const { week, month } = data

  // Helpers para comparar vs mes anterior
  const citasDelta = month.actual.citas - month.anterior.citas
  const ingresosDelta = month.actual.ingresos - month.anterior.ingresos
  const noShowDelta = month.actual.noShowRate - month.anterior.noShowRate

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Estadísticas</h1>
          <p className="text-slate-500 text-sm">Métricas del consultorio en tiempo real</p>
        </div>
        <Link
          href="/dashboard/analytics/vacaciones"
          className="btn-primary text-sm py-2 px-4 whitespace-nowrap shrink-0"
        >
          Planificar vacaciones
        </Link>
      </div>

      {/* ==================== SECCIÓN 0: PÉRDIDAS ESTE MES ==================== */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-red-500">Pérdidas este mes</h2>

        {/* 3 loss cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* No-shows */}
          <div className="card p-5 border-red-200 bg-red-50/40">
            <p className="text-xs font-medium uppercase tracking-wider text-red-400 mb-1">Pérdidas por no-shows</p>
            <p className="text-xl font-bold text-red-600">{formatCOP(data.lossValuation.noShows.amount)} COP</p>
            <p className="text-xs text-red-400 mt-1">
              {data.lossValuation.noShows.count} cita{data.lossValuation.noShows.count !== 1 ? 's' : ''} no atendida{data.lossValuation.noShows.count !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Cancelaciones */}
          <div className="card p-5 border-amber-200 bg-amber-50/40">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-500 mb-1">Pérdidas por cancelaciones</p>
            <p className="text-xl font-bold text-amber-600">{formatCOP(data.lossValuation.cancellations.amount)} COP</p>
            <p className="text-xs text-amber-400 mt-1">
              {data.lossValuation.cancellations.count} cita{data.lossValuation.cancellations.count !== 1 ? 's' : ''} cancelada{data.lossValuation.cancellations.count !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Sin facturar */}
          <div className="card p-5 border-amber-200 bg-amber-50/40">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-500 mb-1">Citas sin facturar</p>
            <p className="text-xl font-bold text-amber-600">{formatCOP(data.lossValuation.unbilled.amount)} COP</p>
            <p className="text-xs text-amber-400 mt-1">
              {data.lossValuation.unbilled.count} cita{data.lossValuation.unbilled.count !== 1 ? 's' : ''} completada{data.lossValuation.unbilled.count !== 1 ? 's' : ''} sin factura
            </p>
          </div>
        </div>

        {/* Total */}
        <div className="card p-5 bg-slate-900 text-white">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-1">Total pérdidas estimadas</p>
              <p className="text-2xl font-bold">{formatCOP(data.lossValuation.total)} COP</p>
              <p className="text-xs text-slate-400 mt-1">
                Este mes · basado en precio de consulta configurado ({formatCOP(data.consultationPrice)} COP)
              </p>
            </div>
            <Link
              href="/dashboard/settings/clinic"
              className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
            >
              Configurar precio →
            </Link>
          </div>
        </div>

        {/* Trend chart */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Ingresos reales vs potenciales</h3>
          <p className="text-xs text-slate-400 mb-4">Últimos 6 meses · la brecha roja representa las pérdidas</p>
          <LossValuationChart data={data.monthTrend} />
        </div>
      </section>

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

      {/* ==================== SECCIÓN 4: AUTOMATIZACIONES ==================== */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Automatizaciones</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">NPS promedio</p>
            <p className={`text-lg font-semibold ${
              data.npsAverage === null ? 'text-slate-400'
                : data.npsAverage >= 8 ? 'text-emerald-600'
                  : data.npsAverage >= 5 ? 'text-amber-600'
                    : 'text-red-600'
            }`}>
              {data.npsAverage !== null ? data.npsAverage.toFixed(1) : 'Sin datos'}
            </p>
            {data.npsCount > 0 && (
              <p className="text-xs text-slate-400 mt-0.5">{data.npsCount} respuesta{data.npsCount !== 1 ? 's' : ''} este mes</p>
            )}
          </div>
          <StatCard
            label="Pacientes inactivos"
            value={String(data.inactivePatients)}
            sub="Sin cita en +90 días"
            valueClass={data.inactivePatients > 10 ? 'text-amber-600' : undefined}
          />
          <StatCard
            label="Reactivados este mes"
            value={String(data.reactivatedThisMonth)}
            valueClass={data.reactivatedThisMonth > 0 ? 'text-teal-700' : undefined}
          />
          <StatCard
            label="Tasa respuesta NPS"
            value={data.npsCount > 0
              ? `${data.npsCount}`
              : '0'}
            sub="Calificaciones recibidas"
          />
        </div>
      </section>

      {/* ==================== SECCIÓN 5: RETENCIÓN ==================== */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Retención de pacientes</h2>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Pacientes recurrentes"
            value={String(data.retention.recurringPatients)}
            sub="Con 2+ visitas completadas"
            valueClass="text-teal-700"
          />
          <StatCard
            label="Tasa de retorno"
            value={`${data.retention.returnRate}%`}
            sub="Pacientes que volvieron tras 1era visita"
            valueClass={data.retention.returnRate >= 50 ? 'text-teal-700' : 'text-amber-600'}
          />
          <StatCard
            label="En riesgo de pérdida"
            value={String(data.retention.atRiskCount)}
            sub="Última visita > frecuencia habitual × 1.5"
            valueClass={data.retention.atRiskCount > 0 ? 'text-red-600' : undefined}
          />
        </div>

        {data.retention.topAtRisk.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Pacientes en riesgo de pérdida</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {data.retention.topAtRisk.map((p) => (
                <div key={p.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/patients/${p.id}`}
                        className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline truncate block"
                      >
                        {p.name}
                      </Link>
                      <p className="text-xs text-slate-400">
                        Frecuencia: cada {p.visitFrequencyDays} días · Última visita: hace {p.daysSinceLastVisit} días
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="badge badge-red">{p.daysSinceLastVisit}d sin visita</span>
                    <ReactivationButton patientId={p.id} patientName={p.name} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ==================== SECCIÓN 6: RENTABILIDAD EPS ==================== */}
      {epsProfitability.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Rentabilidad por EPS</h2>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Facturado vs Cobrado vs Glosado</h3>
            <p className="text-xs text-slate-400 mb-4">Últimos 6 meses · la diferencia entre facturado y cobrado son las pérdidas por glosas y retrasos</p>
            <EpsProfitabilityChart data={epsProfitability} />
          </div>
        </section>
      )}

      {/* ==================== SECCIÓN 7: ALERTAS FINANCIERAS ==================== */}
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
