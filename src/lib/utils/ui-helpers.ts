// ============================================================
// Shared UI helpers — centralized to avoid 10+ duplicates
// getInitials, avatar gradients, formatCOPCompact
// ============================================================

/** Extract 1-2 initials from a name string */
export function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

/** Gradient backgrounds for avatar circles — uses v2 design tokens */
export const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6B5BFF, #8676FF)',
  'linear-gradient(135deg, #FF6BAA, #FF8EC4)',
  'linear-gradient(135deg, #34C77B, #5DD99A)',
  'linear-gradient(135deg, #FFB845, #FFCF7A)',
  'linear-gradient(135deg, #5444E5, #6B5BFF)',
]

/** Deterministic gradient based on name hash */
export function getAvatarGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

/** Compact COP format for KPIs: $1.8M, $350k, $80.000 */
export function formatCOPCompact(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1).replace('.0', '') + 'M'
  if (n >= 1_000) return '$' + Math.round(n / 1_000) + 'k'
  return '$' + n.toLocaleString('es-CO')
}
