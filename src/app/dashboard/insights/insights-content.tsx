'use client'

import { useState, useTransition } from 'react'
import { markInsightRead, submitInsightFeedback } from '@/app/actions/insights'
import type { ClinicInsight, InsightRecommendation, InsightDataSufficiency } from '@/app/actions/insights'
import { formatCOP } from '@/lib/utils/dates'
import Link from 'next/link'

// Colores y labels por tipo de recomendación
const TYPE_CONFIG: Record<
  InsightRecommendation['type'],
  { bg: string; border: string; text: string; icon: string; label: string; glow: boolean }
> = {
  OPORTUNIDAD: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-800',
    icon: '💰',
    label: 'Oportunidad',
    glow: true,
  },
  ALERTA: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: '⚠️',
    label: 'Alerta',
    glow: false,
  },
  RIESGO: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    icon: '🔴',
    label: 'Riesgo',
    glow: false,
  },
  LOGRO: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    icon: '🏆',
    label: 'Logro',
    glow: false,
  },
}

// Confidence badge config
const CONFIDENCE_CONFIG: Record<1 | 2 | 3, { dot: string; label: string; bg: string; text: string }> = {
  1: { dot: 'bg-amber-400', label: 'Estimado', bg: 'bg-amber-50', text: 'text-amber-700' },
  2: { dot: 'bg-emerald-500', label: 'Confiable', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  3: { dot: 'bg-emerald-600', label: 'Alta confianza', bg: 'bg-emerald-50', text: 'text-emerald-700' },
}

const MODULE_LINKS: Record<string, { href: string; label: string }> = {
  agenda: { href: '/dashboard', label: 'Ir a Agenda' },
  noshow: { href: '/dashboard/noshow', label: 'Ir a No-Shows' },
  cartera: { href: '/dashboard/cartera', label: 'Ir a Cartera' },
  espera: { href: '/dashboard/espera', label: 'Ir a Lista de espera' },
  patients: { href: '/dashboard/patients', label: 'Ir a Pacientes' },
  facturacion: { href: '/dashboard/facturacion', label: 'Ir a Facturación' },
}

interface InsightsContentProps {
  insights: ClinicInsight[]
  todayInsight: ClinicInsight | null
  dataSufficiency: InsightDataSufficiency
}

export function InsightsContent({
  insights,
  todayInsight,
  dataSufficiency,
}: InsightsContentProps) {
  const [showHistory, setShowHistory] = useState(false)

  // ==================== EMPTY STATE (datos insuficientes) ====================
  if (!todayInsight && !dataSufficiency.anyReady) {
    return (
      <div className="space-y-8">
        {/* Mensaje principal */}
        <div className="text-center max-w-xl mx-auto">
          <div className="relative inline-block mb-4">
            <span className="text-6xl">🔮</span>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500" />
            </span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            Tu consultor ya está listo
          </h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            En cuanto tengamos suficiente información sobre tu consultorio,
            comenzará a trabajar para ti. Mientras más datos tenga, más precisas
            y valiosas serán sus recomendaciones.
          </p>
        </div>

        {/* Progreso por categoría */}
        <DataSufficiencyProgress categories={dataSufficiency.categories} />

        {/* Teaser cards (blurred) */}
        <div className="space-y-3 max-w-2xl mx-auto">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider text-center">
            Próximamente verás recomendaciones como estas
          </p>

          {/* Teaser 1 — Oportunidad */}
          <div className="relative rounded-xl border border-emerald-200 bg-emerald-50 p-5 overflow-hidden">
            <div className="blur-[6px] select-none pointer-events-none">
              <div className="flex items-center gap-2 mb-2">
                <span>💡</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                  Oportunidad
                </span>
                <span className="ml-auto text-lg font-bold text-slate-900">+$320.000/mes</span>
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                Detectamos un patrón en tu agenda que podrías optimizar
              </p>
              <p className="text-xs text-slate-600">
                Tus franjas de la tarde tienen 40% menos ocupación que las de la mañana...
              </p>
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[2px]">
              <span className="bg-white/90 border border-slate-200 text-slate-600 text-xs font-medium px-4 py-2 rounded-full shadow-sm">
                🔒 Disponible con más datos
              </span>
            </div>
          </div>

          {/* Teaser 2 — Alerta */}
          <div className="relative rounded-xl border border-amber-200 bg-amber-50 p-5 overflow-hidden">
            <div className="blur-[6px] select-none pointer-events-none">
              <div className="flex items-center gap-2 mb-2">
                <span>⚠️</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                  Alerta
                </span>
                <span className="ml-auto text-lg font-bold text-slate-900">$480.000 en riesgo</span>
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                Tu tasa de no-shows los viernes está por encima del promedio
              </p>
              <p className="text-xs text-slate-600">
                Los viernes tienes un 28% de no-shows comparado con el 12% del resto de la semana...
              </p>
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[2px]">
              <span className="bg-white/90 border border-slate-200 text-slate-600 text-xs font-medium px-4 py-2 rounded-full shadow-sm">
                🔒 Disponible con más datos
              </span>
            </div>
          </div>

          {/* Teaser 3 — Logro */}
          <div className="relative rounded-xl border border-blue-200 bg-blue-50 p-5 overflow-hidden">
            <div className="blur-[6px] select-none pointer-events-none">
              <div className="flex items-center gap-2 mb-2">
                <span>🏆</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-800">
                  Logro
                </span>
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                Ya lo estás haciendo bien — tu retención de pacientes es excelente
              </p>
              <p className="text-xs text-slate-600">
                Comparado con consultorios similares, tu tasa de retorno es un 15% superior...
              </p>
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[2px]">
              <span className="bg-white/90 border border-slate-200 text-slate-600 text-xs font-medium px-4 py-2 rounded-full shadow-sm">
                🔒 Disponible con más datos
              </span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center max-w-md mx-auto pt-2">
          <p className="text-sm text-slate-500 mb-3">
            ¿Quieres acelerar? Asegúrate de que todas tus citas estén registradas en Omuwan.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 bg-[#1e3a5f] hover:bg-[#2d5a8e] text-white text-sm font-medium py-2.5 px-6 rounded-lg transition-colors"
          >
            Ver agenda →
          </Link>
        </div>
      </div>
    )
  }

  // ==================== SIN INSIGHTS HOY, PERO CON HISTORIAL ====================
  if (!todayInsight) {
    return (
      <div className="space-y-6">
        <div className="card p-12 text-center">
          <p className="text-4xl mb-4">📊</p>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            Tus insights se generan cada mañana
          </h3>
          <p className="text-slate-500 text-sm">
            Mañana a las 6:30 AM recibirás recomendaciones basadas en los datos de tu consultorio.
          </p>
        </div>

        {/* Mostrar progreso por categoría si no todas están listas */}
        {!dataSufficiency.allReady && (
          <DataSufficiencyProgress categories={dataSufficiency.categories} />
        )}

        {insights.length > 0 && (
          <HistorySection insights={insights} />
        )}
      </div>
    )
  }

  // ==================== CON INSIGHTS DE HOY ====================
  const totalImpact = todayInsight.recommendations.reduce(
    (sum, r) => sum + Math.abs(r.impact_cop),
    0
  )

  const todayDate = new Date(todayInsight.generated_at).toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Bogota',
  })

  const generatedTime = new Date(todayInsight.generated_at).toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Bogota',
  })

  return (
    <div className="space-y-6">
      {/* Banner de impacto */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0f2a4a] via-[#1e3a5f] to-[#2d5a8e] p-6 lg:p-8 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <p className="text-white/60 text-sm flex items-center gap-2">
              <span>🧠</span> Análisis de hoy — <span className="capitalize">{todayDate}</span>
            </p>
            <p className="text-white text-3xl lg:text-4xl font-bold mt-1">
              +{formatCOP(totalImpact)} COP
            </p>
            <p className="text-white/50 text-xs mt-1">
              Oportunidades identificadas
            </p>
          </div>
          <div className="text-left lg:text-right">
            <p className="text-white/50 text-xs">
              Actualizado a las {generatedTime}
            </p>
            <p className="text-white/40 text-xs">
              {todayInsight.recommendations.length} recomendaciones
            </p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-emerald-300 text-sm font-medium">
            Si actúas en todas las recomendaciones de hoy, podrías generar{' '}
            <span className="font-bold">{formatCOP(totalImpact)}</span> adicionales este mes.
          </p>
        </div>
      </div>

      {/* Tarjetas de recomendaciones */}
      <div className="space-y-4">
        {todayInsight.recommendations.map((rec, idx) => (
          <RecommendationCard
            key={idx}
            recommendation={rec}
            index={idx}
            insightId={todayInsight.id}
            isRead={todayInsight.is_read}
            currentVote={todayInsight.feedback[String(idx)] ?? null}
          />
        ))}
      </div>

      {/* Marcar como leído */}
      {!todayInsight.is_read && (
        <MarkReadButton insightId={todayInsight.id} />
      )}

      {/* Historial */}
      {insights.length > 1 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-sm text-[#1e3a5f] hover:underline font-medium"
          >
            {showHistory ? 'Ocultar historial' : `Ver historial (${insights.length - 1} días anteriores)`}
          </button>
          {showHistory && (
            <HistorySection
              insights={insights.filter((i) => i.id !== todayInsight.id)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ==================== Progreso por categoría ====================

function DataSufficiencyProgress({ categories }: { categories: InsightDataSufficiency['categories'] }) {
  return (
    <div className="card p-6 max-w-xl mx-auto">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 text-center">
        Progreso hacia tus primeros insights
      </p>
      <div className="space-y-3">
        {categories.map((cat) => {
          const pct = Math.min(Math.round((cat.current / cat.required) * 100), 100)
          const unit = cat.key === 'occupancy' ? 'semanas' : cat.key === 'retention' || cat.key === 'reactivation' ? 'pacientes' : cat.key === 'cartera' ? 'registros' : 'citas'
          return (
            <div key={cat.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{cat.icon}</span>
                  <span className="text-sm font-medium text-slate-700">{cat.label}</span>
                </div>
                <span className="text-xs text-slate-500">
                  {cat.ready ? (
                    <span className="text-emerald-600 font-semibold">Listo</span>
                  ) : (
                    <>{cat.current}/{cat.required} {unit}</>
                  )}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full transition-all duration-700 ${
                    cat.ready
                      ? 'bg-emerald-500'
                      : pct >= 60
                        ? 'bg-amber-400'
                        : 'bg-slate-300'
                  }`}
                  style={{ width: `${Math.max(pct, 4)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ==================== Tarjeta de recomendación ====================

function RecommendationCard({
  recommendation: rec,
  index,
  insightId,
  isRead,
  currentVote,
}: {
  recommendation: InsightRecommendation
  index: number
  insightId: string
  isRead: boolean
  currentVote: 'up' | 'down' | null
}) {
  const config = TYPE_CONFIG[rec.type]
  const moduleLink = MODULE_LINKS[rec.module]
  const confidence = CONFIDENCE_CONFIG[rec.confidence ?? 2]
  const [vote, setVote] = useState(currentVote)
  const [isPending, startTransition] = useTransition()

  const isUrgent = rec.type === 'ALERTA' || rec.type === 'RIESGO'
  const weeklyLoss = Math.round(rec.impact_cop / 4)

  function handleVote(v: 'up' | 'down') {
    setVote(v)
    startTransition(async () => {
      await submitInsightFeedback(insightId, index, v)
    })
  }

  return (
    <div
      className={`rounded-xl border-2 ${config.border} ${config.bg} p-5 lg:p-6 transition-all ${
        !isRead ? 'ring-2 ring-[#1e3a5f]/20' : ''
      } ${config.glow ? 'shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_-5px_rgba(16,185,129,0.4)]' : ''}`}
      style={config.glow ? { animation: 'insightGlow 3s ease-in-out infinite' } : undefined}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{config.icon}</span>
          <span className={`text-xs font-semibold uppercase tracking-wider ${config.text}`}>
            {config.label}
          </span>
          {/* Confidence badge */}
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${confidence.bg} ${confidence.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${confidence.dot}`} />
            {confidence.label}
          </span>
        </div>
        <span className="text-2xl lg:text-[28px] font-bold text-slate-900 leading-none">
          {formatCOP(Math.abs(rec.impact_cop))}
        </span>
      </div>

      {/* Título */}
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{rec.title}</h3>

      {/* Observación */}
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">{rec.observation}</p>

      {/* Acción */}
      <div className="bg-white/70 rounded-lg px-4 py-3 mb-4 border border-white/90">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Acción recomendada
        </p>
        <p className="text-sm text-slate-800 leading-relaxed">{rec.action}</p>
      </div>

      {/* Urgencia para ALERTA y RIESGO */}
      {isUrgent && weeklyLoss > 0 && (
        <p className="text-xs text-red-600 font-medium mb-4">
          ⏰ Cada semana que pasa sin actuar = {formatCOP(weeklyLoss)} adicionales perdidos
        </p>
      )}

      {/* Social proof */}
      <p className="text-xs text-slate-400 italic mb-4">
        Consultorios que aplicaron esto vieron resultados en promedio en 2 semanas.
      </p>

      {/* Footer: módulo + feedback */}
      <div className="flex items-center justify-between pt-3 border-t border-black/5">
        {moduleLink && (
          <Link
            href={moduleLink.href}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1e3a5f] hover:text-[#2d5a8e] transition-colors"
          >
            {moduleLink.label} →
          </Link>
        )}

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleVote('up')}
            disabled={isPending}
            className={`px-2.5 py-1.5 rounded-lg text-sm transition-all ${
              vote === 'up'
                ? 'bg-emerald-100 text-emerald-700 scale-110'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
            }`}
            title="Útil"
          >
            👍
          </button>
          <button
            onClick={() => handleVote('down')}
            disabled={isPending}
            className={`px-2.5 py-1.5 rounded-lg text-sm transition-all ${
              vote === 'down'
                ? 'bg-red-100 text-red-700 scale-110'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
            }`}
            title="No útil"
          >
            👎
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== Botón marcar como leído ====================

function MarkReadButton({ insightId }: { insightId: string }) {
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (done) return null

  return (
    <button
      onClick={() => {
        startTransition(async () => {
          await markInsightRead(insightId)
          setDone(true)
        })
      }}
      disabled={isPending}
      className="w-full py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
    >
      {isPending ? 'Marcando...' : 'Marcar como leído'}
    </button>
  )
}

// ==================== Historial ====================

function HistorySection({ insights }: { insights: ClinicInsight[] }) {
  return (
    <div className="mt-4 space-y-3">
      {insights.map((insight) => {
        const totalImpact = insight.recommendations.reduce(
          (sum, r) => sum + Math.abs(r.impact_cop),
          0
        )
        const date = new Date(insight.generated_at).toLocaleDateString('es-CO', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'America/Bogota',
        })
        return (
          <div key={insight.id} className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-900 capitalize">{date}</p>
              <p className="text-sm font-semibold text-slate-700">{formatCOP(totalImpact)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {insight.recommendations.map((rec, idx) => {
                const cfg = TYPE_CONFIG[rec.type]
                return (
                  <span
                    key={idx}
                    className={`text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} font-medium`}
                  >
                    {cfg.icon} {rec.title.length > 40 ? rec.title.slice(0, 40) + '...' : rec.title}
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
