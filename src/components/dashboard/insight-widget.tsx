import Link from 'next/link'
import { formatCOP } from '@/lib/utils/dates'
import type { InsightRecommendation } from '@/app/actions/insights'

const TYPE_ICONS: Record<InsightRecommendation['type'], string> = {
  OPORTUNIDAD: '💰',
  ALERTA: '⚠️',
  RIESGO: '🔴',
  LOGRO: '🏆',
}

export function InsightWidget({ recommendation }: { recommendation: InsightRecommendation }) {
  const icon = TYPE_ICONS[recommendation.type]

  return (
    <Link href="/dashboard/insights" className="block">
      <div className="card p-4 hover:shadow-md transition-shadow border-l-4 border-l-[#1e3a5f]">
        <div className="flex items-start gap-3">
          <span className="text-lg mt-0.5">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-semibold text-[#1e3a5f] uppercase tracking-wider">
                Insight del día
              </p>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                {formatCOP(Math.abs(recommendation.impact_cop))}
              </span>
            </div>
            <p className="text-sm font-medium text-slate-900 truncate">{recommendation.title}</p>
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{recommendation.action}</p>
          </div>
          <span className="text-slate-400 text-sm shrink-0">→</span>
        </div>
      </div>
    </Link>
  )
}
