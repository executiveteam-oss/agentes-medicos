import {
  computeCutoff, resolveRetentionYears, isEligibleForDeletion, isStalePending,
  exceedsVolumeGuard, RETENTION_DEFAULT_YEARS, VOLUME_GUARD_MAX, STALE_PENDING_ALERT_DAYS,
} from '../src/lib/retention/document-retention'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests — retención de documentos (lógica pura)\n')

const NOW = new Date('2026-07-28T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000).toISOString()
const yearsAgo = (y: number) => { const d = new Date(NOW); d.setFullYear(d.getFullYear() - y); return d.toISOString() }

// --- computeCutoff ---
assert('cutoff 2 años atrás', computeCutoff(2, NOW).getUTCFullYear() === 2024)
assert('cutoff lanza con 0 (no barrer todo)', (() => { try { computeCutoff(0, NOW); return false } catch { return true } })())
assert('cutoff lanza con negativo', (() => { try { computeCutoff(-1, NOW); return false } catch { return true } })())
assert('cutoff lanza con NaN', (() => { try { computeCutoff(NaN, NOW); return false } catch { return true } })())

// --- resolveRetentionYears (defensivo) ---
assert('resolve default sin config', resolveRetentionYears(null) === RETENTION_DEFAULT_YEARS)
assert('resolve default sin la clave', resolveRetentionYears({ otra: 1 }) === 2)
assert('resolve lee número válido', resolveRetentionYears({ document_retention_years: 5 }) === 5)
assert('resolve lee string numérico', resolveRetentionYears({ document_retention_years: '3' }) === 3)
assert('resolve cae a default con 0 (no acortar por bug)', resolveRetentionYears({ document_retention_years: 0 }) === 2)
assert('resolve cae a default con negativo', resolveRetentionYears({ document_retention_years: -1 }) === 2)
assert('resolve cae a default con basura', resolveRetentionYears({ document_retention_years: 'abc' }) === 2)
assert('resolve cae a default con fraccional', resolveRetentionYears({ document_retention_years: 1.5 }) === 2)

// --- isEligibleForDeletion ---
const cutoff2y = computeCutoff(2, NOW)
const oldDoc = { createdAt: yearsAgo(3), context: 'document_general', reviewedAt: daysAgo(900) }
const newDoc = { createdAt: yearsAgo(1), context: 'document_general', reviewedAt: daysAgo(300) }
const oldReviewedAuth = { createdAt: yearsAgo(3), context: 'authorization', reviewedAt: yearsAgo(3) }
const oldPendingAuth = { createdAt: yearsAgo(3), context: 'authorization', reviewedAt: null }

assert('viejo sin cita → elegible', isEligibleForDeletion(oldDoc, cutoff2y, false) === true)
assert('reciente → NO elegible', isEligibleForDeletion(newDoc, cutoff2y, false) === false)
assert('viejo pero cita futura (Exc A) → NO elegible', isEligibleForDeletion(oldDoc, cutoff2y, true) === false)
assert('viejo authorization YA revisado → elegible', isEligibleForDeletion(oldReviewedAuth, cutoff2y, false) === true)
assert('viejo authorization SIN revisar (Exc B) → NO elegible', isEligibleForDeletion(oldPendingAuth, cutoff2y, false) === false)
assert('justo en el cutoff (>=) → NO elegible', isEligibleForDeletion({ createdAt: cutoff2y.toISOString(), context: 'other', reviewedAt: null }, cutoff2y, false) === false)

// --- isStalePending ---
assert('pending 40 días → estancado', isStalePending({ createdAt: daysAgo(40), context: 'authorization', reviewedAt: null }, NOW, STALE_PENDING_ALERT_DAYS) === true)
assert('pending 10 días → NO estancado', isStalePending({ createdAt: daysAgo(10), context: 'authorization', reviewedAt: null }, NOW, STALE_PENDING_ALERT_DAYS) === false)
assert('authorization ya revisado → NO estancado', isStalePending({ createdAt: daysAgo(40), context: 'authorization', reviewedAt: daysAgo(35) }, NOW, STALE_PENDING_ALERT_DAYS) === false)
assert('document_general viejo → NO estancado (solo authorization)', isStalePending({ createdAt: daysAgo(40), context: 'document_general', reviewedAt: null }, NOW, STALE_PENDING_ALERT_DAYS) === false)

// --- exceedsVolumeGuard ---
assert('100 exacto → NO excede', exceedsVolumeGuard(VOLUME_GUARD_MAX) === false)
assert('101 → excede', exceedsVolumeGuard(VOLUME_GUARD_MAX + 1) === true)
assert('0 → NO excede', exceedsVolumeGuard(0) === false)

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
