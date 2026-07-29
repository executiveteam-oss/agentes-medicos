// Lógica pura del claim de conversaciones (Pieza A). Sin DB/red.
// El vencimiento se computa AL LEER: claimed_at + expiryMinutes < now → libre.

export interface ClaimConfig {
  enabled: boolean
  mode: 'soft' | 'hard'
  expiryMinutes: number
}

export const CLAIM_DEFAULTS: ClaimConfig = { enabled: true, mode: 'soft', expiryMinutes: 10 }

/** Lee clinics.feature_config y devuelve la config de claim con defaults. Tolerante a basura. */
export function parseClaimConfig(featureConfig: unknown): ClaimConfig {
  const root = (featureConfig && typeof featureConfig === 'object') ? (featureConfig as Record<string, unknown>) : {}
  const raw = (root.claim && typeof root.claim === 'object') ? (root.claim as Record<string, unknown>) : {}
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : CLAIM_DEFAULTS.enabled
  const mode = raw.mode === 'hard' ? 'hard' : 'soft'
  const expRaw = raw.expiry_minutes
  const expiryMinutes = (typeof expRaw === 'number' && Number.isFinite(expRaw) && expRaw > 0) ? expRaw : CLAIM_DEFAULTS.expiryMinutes
  return { enabled, mode, expiryMinutes }
}

export interface ClaimRow {
  claimed_by: string | null
  claimed_by_name: string | null
  claimed_at: string | null
}

export type ClaimState = 'free' | 'mine' | 'others'

/** ¿El claim está vigente (no vencido)? Borde (exacto expiry) cuenta como VENCIDO. */
export function isClaimActive(claimedAt: string | null, expiryMinutes: number, nowMs: number): boolean {
  if (!claimedAt) return false
  const claimedMs = Date.parse(claimedAt)
  if (Number.isNaN(claimedMs)) return false
  return (nowMs - claimedMs) < (expiryMinutes * 60_000)
}

/** Estado del claim relativo a mí. 'others' = tomada por otra persona y vigente. */
export function resolveClaimState(
  row: ClaimRow, myUserId: string, expiryMinutes: number, nowMs: number,
): { state: ClaimState; byName: string | null; heldMinutes: number | null } {
  if (!row.claimed_by || !isClaimActive(row.claimed_at, expiryMinutes, nowMs)) {
    return { state: 'free', byName: null, heldMinutes: null }
  }
  if (row.claimed_by === myUserId) {
    return { state: 'mine', byName: row.claimed_by_name, heldMinutes: null }
  }
  const heldMinutes = row.claimed_at ? Math.floor((nowMs - Date.parse(row.claimed_at)) / 60_000) : null
  return { state: 'others', byName: row.claimed_by_name, heldMinutes }
}
