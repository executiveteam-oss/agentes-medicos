'use client'

// ============================================================
// NoShowDashboard v2 — Hero, KPIs, chart, risk patients
// ============================================================

import { useRouter, useSearchParams } from 'next/navigation'
import { NoShowCharts } from '@/components/dashboard/noshow-charts'
import { TrendingDown, DollarSign, AlertTriangle, Calendar, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import Link from 'next/link'

// ---- Types ----

interface RiskPatient {
  name: string
  phone: string
  noShowCount: number
  totalAppointments: number
  rate: number
  lastNoShow: string
}

interface ChartDay {
  dia: string
  completadas: number
  noShows: number
  tasa: number
}

interface Props {
  rangeDays: number
  currentRate: number
  currentTotal: number
  currentNoShows: number
  costLost: number
  delta: number | null
  previous: { totalAppointments: number; noShows: number; rate: number } | null
  hasEnoughHistory: boolean
  worstDay: string
  worstDayRate: number
  riskPatientsCount: number
  riskPatients: RiskPatient[]
  chartData: ChartDay[]
}

// ---- Helpers ----

function formatCOP(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1).replace('.0', '') + 'M'
  if (n >= 1_000) return '$' + Math.round(n / 1_000) + 'k'
  return '$' + n.toLocaleString('es-CO')
}

const DAY_LABELS: Record<string, string> = {
  lun: 'Lunes', mar: 'Martes', mie: 'Miercoles', jue: 'Jueves',
  vie: 'Viernes', sab: 'Sabado', dom: 'Domingo',
}

const RANGE_OPTIONS = [
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '3 meses' },
  { value: 365, label: 'Ano' },
]

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6B5BFF, #8676FF)',
  'linear-gradient(135deg, #FF6BAA, #FF8EC4)',
  'linear-gradient(135deg, #34C77B, #5DD99A)',
  'linear-gradient(135deg, #FFB845, #FFCF7A)',
  'linear-gradient(135deg, #5444E5, #6B5BFF)',
]

function getGradient(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length]
}

// ---- Main Component ----

export function NoShowDashboard(props: Props) {
  const { rangeDays, currentRate, currentTotal, currentNoShows, costLost, delta, previous, hasEnoughHistory, worstDay, worstDayRate, riskPatientsCount, riskPatients, chartData } = props
  const router = useRouter()
  const searchParams = useSearchParams()

  const improved = delta !== null && delta < 0
  const worsened = delta !== null && delta > 0

  function setRange(days: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('range', String(days))
    router.push(`/dashboard/noshow?${params.toString()}`)
  }

  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === rangeDays)?.label ?? `${rangeDays} dias`

  return (
    <div className="space-y-6" style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>
      {/* Header + Range pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h1
            className="text-2xl sm:text-3xl"
            style={{ fontWeight: 800, color: 'var(--v2-text)', letterSpacing: '-0.02em' }}
          >
            Analisis de{' '}
            <span
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: 'italic',
                fontWeight: 400,
                background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              no-shows
            </span>
          </h1>
        </div>

        {/* Range pills */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '4px',
            borderRadius: 'var(--v2-radius)',
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
          }}
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: rangeDays === opt.value ? 700 : 500,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-manrope), sans-serif',
                transition: 'all 0.15s',
                ...(rangeDays === opt.value
                  ? { background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)', color: '#fff', boxShadow: '0 2px 6px rgba(107,91,255,0.25)' }
                  : { background: 'transparent', color: 'var(--v2-text-muted)' }),
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alert banner if rate > 20% */}
      {currentRate > 20 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '16px 20px',
            borderRadius: 'var(--v2-radius-lg)',
            background: 'var(--v2-amber-soft)',
            border: '1px solid rgba(255,184,69,0.3)',
          }}
        >
          <AlertTriangle size={18} style={{ color: '#b07d00', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#b07d00', marginBottom: '8px' }}>
              Tu tasa de no-show es alta ({currentRate}%)
            </p>
            <ul style={{ fontSize: '12.5px', color: '#b07d00', lineHeight: 1.6, paddingLeft: '16px', margin: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <li><Link href="/dashboard/whatsapp" style={{ fontWeight: 600, textDecoration: 'underline' }}>Activa recordatorios 24h antes</Link></li>
              <li>Revisa pacientes recurrentes para confirmar manualmente</li>
              <li><Link href="/dashboard/espera" style={{ fontWeight: 600, textDecoration: 'underline' }}>Usa lista de espera</Link> para reasignar slots</li>
            </ul>
          </div>
        </div>
      )}

      {/* ===== HERO STAT ===== */}
      <div
        style={{
          borderRadius: 'var(--v2-radius-xl)',
          padding: '36px 32px',
          position: 'relative',
          overflow: 'hidden',
          ...(improved || !hasEnoughHistory
            ? {
                background: 'linear-gradient(135deg, #0F0A1F, #1A0F33, #2A1547)',
                color: '#fff',
              }
            : {
                background: 'var(--v2-bg-card)',
                border: '1px solid var(--v2-border-soft)',
                boxShadow: 'var(--v2-shadow)',
              }),
        }}
      >
        {/* Decorative gradients for dark variant */}
        {(improved || !hasEnoughHistory) && (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(107,91,255,0.15), transparent 50%), radial-gradient(circle at 80% 50%, rgba(255,107,170,0.1), transparent 50%)', pointerEvents: 'none' }} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center" style={{ position: 'relative' }}>
          {/* Left: Stats */}
          <div>
            <p style={{
              fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
              marginBottom: '12px',
              color: improved || !hasEnoughHistory ? 'rgba(255,255,255,0.5)' : 'var(--v2-text-subtle)',
            }}>
              {delta !== null ? (improved ? 'Reduccion acumulada' : 'Variacion') : 'Tasa actual'} &middot; {rangeLabel}
            </p>

            {/* Big number */}
            {delta !== null ? (
              <p
                className="text-6xl sm:text-7xl lg:text-[88px]"
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontStyle: 'italic',
                  fontWeight: 400,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                  color: improved ? 'var(--v2-green)' : 'var(--v2-pink)',
                  marginBottom: '16px',
                }}
              >
                {improved ? '↓' : '↑'}{Math.abs(delta)}%
              </p>
            ) : (
              <p
                className="text-6xl sm:text-7xl lg:text-[88px]"
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontStyle: 'italic',
                  fontWeight: 400,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                  color: improved || !hasEnoughHistory ? '#fff' : 'var(--v2-text)',
                  marginBottom: '16px',
                }}
              >
                {currentRate}%
              </p>
            )}

            {/* Explanation */}
            <p style={{
              fontSize: '15px', lineHeight: 1.6, maxWidth: '420px', marginBottom: '20px',
              color: improved || !hasEnoughHistory ? 'rgba(255,255,255,0.6)' : 'var(--v2-text-muted)',
            }}>
              {improved
                ? `Tus no-shows bajaron ${Math.abs(delta!)}% en los ultimos ${rangeDays} dias vs el periodo anterior.`
                : worsened
                  ? `Tu tasa de no-show subio ${delta}% en los ultimos ${rangeDays} dias. Considera activar recordatorios automaticos.`
                  : hasEnoughHistory
                    ? `Tu tasa se mantuvo estable en ${currentRate}% durante los ultimos ${rangeDays} dias.`
                    : `Estamos recopilando datos. Necesitamos al menos ${rangeDays * 2} dias para mostrar tendencias.`
              }
            </p>

            {/* Context row */}
            {previous && (
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: improved || !hasEnoughHistory ? 'rgba(255,255,255,0.4)' : 'var(--v2-text-subtle)' }}>Antes</p>
                  <p style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: improved || !hasEnoughHistory ? 'rgba(255,255,255,0.7)' : 'var(--v2-text-muted)' }}>{previous.rate}%</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: improved || !hasEnoughHistory ? 'rgba(255,255,255,0.4)' : 'var(--v2-text-subtle)' }}>Ahora</p>
                  <p style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: improved ? 'var(--v2-green)' : worsened ? 'var(--v2-pink)' : (improved || !hasEnoughHistory ? '#fff' : 'var(--v2-text)') }}>{currentRate}%</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: improved || !hasEnoughHistory ? 'rgba(255,255,255,0.4)' : 'var(--v2-text-subtle)' }}>Costo perdido</p>
                  <p style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: improved || !hasEnoughHistory ? 'var(--v2-amber)' : 'var(--v2-text)' }}>{formatCOP(costLost)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Right: mini summary */}
          <div className="hidden lg:flex" style={{ justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '280px' }}>
              {[
                { label: 'Total citas', value: String(currentTotal), color: improved || !hasEnoughHistory ? '#fff' : 'var(--v2-text)' },
                { label: 'No-shows', value: String(currentNoShows), color: 'var(--v2-pink)' },
                { label: 'Costo perdido', value: formatCOP(costLost), color: 'var(--v2-amber)' },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    background: improved || !hasEnoughHistory ? 'rgba(255,255,255,0.06)' : 'var(--v2-bg-soft)',
                    border: improved || !hasEnoughHistory ? '1px solid rgba(255,255,255,0.08)' : '1px solid var(--v2-border-soft)',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 500, color: improved || !hasEnoughHistory ? 'rgba(255,255,255,0.5)' : 'var(--v2-text-muted)' }}>{s.label}</span>
                  <span style={{ fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ===== KPI ROW ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={<TrendingDown size={18} />}
          iconBg="var(--v2-pink-soft)" iconColor="var(--v2-pink)"
          label="Tasa de no-show"
          value={`${currentRate}%`}
          detail={`${currentNoShows} de ${currentTotal} citas`}
          trend={delta !== null ? { value: `${delta > 0 ? '↗ +' : '↘ '}${Math.abs(delta)}%`, positive: delta <= 0 } : undefined}
        />
        <KPICard
          icon={<DollarSign size={18} />}
          iconBg="var(--v2-primary-soft)" iconColor="var(--v2-primary)"
          label="Costo estimado"
          value={formatCOP(costLost)}
          detail="calculado por tipo de consulta"
        />
        <KPICard
          icon={<AlertTriangle size={18} />}
          iconBg="var(--v2-amber-soft)" iconColor="#b07d00"
          label="Pacientes recurrentes"
          value={String(riskPatientsCount)}
          detail="necesitan seguimiento"
        />
        <KPICard
          icon={<Calendar size={18} />}
          iconBg="var(--v2-green-soft)" iconColor="var(--v2-green-deep)"
          label="Dia con mas no-shows"
          value={DAY_LABELS[worstDay] ?? worstDay}
          detail={`${worstDayRate}% tasa`}
        />
      </div>

      {/* ===== CHART + RISK PATIENTS ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        {/* Chart */}
        <div
          style={{
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: 'var(--v2-radius-lg)',
            boxShadow: 'var(--v2-shadow-sm)',
            padding: '22px',
          }}
        >
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v2-text)' }}>No-shows por dia de la semana</h2>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>{rangeLabel}</p>
          </div>

          {currentTotal === 0 ? (
            <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: '13px', color: 'var(--v2-text-subtle)' }}>Sin datos suficientes</p>
            </div>
          ) : (
            <NoShowCharts data={chartData} />
          )}

          <div style={{ display: 'flex', gap: '20px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--v2-border-soft)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--v2-text-subtle)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--v2-primary)' }} /> Completadas
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--v2-text-subtle)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--v2-pink)' }} /> No-shows
            </span>
          </div>
        </div>

        {/* Risk patients */}
        <div
          style={{
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: 'var(--v2-radius-lg)',
            boxShadow: 'var(--v2-shadow-sm)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v2-text)' }}>Pacientes con mayor riesgo</h2>
            {riskPatientsCount > 0 && (
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: 'var(--v2-pink)', color: '#fff' }}>
                {riskPatientsCount}
              </span>
            )}
          </div>

          {riskPatients.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--v2-green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <Zap size={18} style={{ color: 'var(--v2-green)' }} />
              </div>
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>Ningun paciente recurrente</p>
              <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>Buen trabajo cuidando tu agenda</p>
            </div>
          ) : (
            <div>
              {riskPatients.map((p, idx) => (
                <div
                  key={p.phone}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 18px',
                    borderBottom: idx < riskPatients.length - 1 ? '1px solid var(--v2-border-soft)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div
                    style={{
                      width: '36px', height: '36px', borderRadius: '50%',
                      background: getGradient(p.name),
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}
                  >
                    <span style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{getInitials(p.name)}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </p>
                    <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>
                      {formatDistanceToNow(new Date(p.lastNoShow), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{
                      fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace',
                      color: p.noShowCount >= 4 ? 'var(--v2-red)' : p.noShowCount >= 2 ? '#b07d00' : 'var(--v2-text-muted)',
                    }}>
                      {p.noShowCount}
                    </p>
                    <p style={{ fontSize: '9px', fontWeight: 600, color: 'var(--v2-text-subtle)' }}>
                      no-show{p.noShowCount > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- KPI Card ----

function KPICard({
  icon, iconBg, iconColor, label, value, detail, trend,
}: {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  value: string
  detail: string
  trend?: { value: string; positive: boolean }
}) {
  return (
    <div
      style={{
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        borderRadius: 'var(--v2-radius-lg)',
        boxShadow: 'var(--v2-shadow-sm)',
        padding: '20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div
          style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: iconBg, display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: iconColor,
          }}
        >
          {icon}
        </div>
        {trend && (
          <span
            style={{
              fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px',
              background: trend.positive ? 'var(--v2-green-soft)' : 'var(--v2-pink-soft)',
              color: trend.positive ? 'var(--v2-green-deep)' : 'var(--v2-pink)',
            }}
          >
            {trend.value}
          </span>
        )}
      </div>
      <p style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--v2-text-subtle)', marginBottom: '4px' }}>
        {label}
      </p>
      <p style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)', letterSpacing: '-0.02em' }}>
        {value}
      </p>
      <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--v2-text-subtle)', marginTop: '2px' }}>{detail}</p>
    </div>
  )
}
