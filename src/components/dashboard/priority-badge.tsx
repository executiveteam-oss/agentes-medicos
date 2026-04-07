// ============================================================
// PriorityBadge — Badge reutilizable de prioridad de paciente
// Tier: high (gold), mid (blue), low (gray)
// ============================================================

export type PriorityTier = 'high' | 'mid' | 'low'

const TIER_CONFIG: Record<PriorityTier, { label: string; icon: string; className: string }> = {
  high: {
    label: 'Prioritario',
    icon: '⭐',
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  mid: {
    label: 'Regular',
    icon: '',
    className: 'bg-blue-50/60 text-blue-600 border border-blue-100',
  },
  low: {
    label: 'Bajo',
    icon: '',
    className: 'bg-slate-50 text-slate-400 border border-slate-200',
  },
}

export function PriorityBadge({
  tier,
  score,
  showScore = false,
  size = 'sm',
}: {
  tier: PriorityTier
  score?: number
  showScore?: boolean
  size?: 'sm' | 'xs'
}) {
  const config = TIER_CONFIG[tier]
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'

  return (
    <span className={`inline-flex items-center gap-1 ${textSize} font-medium px-2 py-0.5 rounded-full ${config.className}`}>
      {config.icon && <span>{config.icon}</span>}
      {config.label}
      {showScore && score !== undefined && (
        <span className="opacity-60">({score})</span>
      )}
    </span>
  )
}
