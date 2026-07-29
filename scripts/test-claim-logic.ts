import {
  CLAIM_DEFAULTS, parseClaimConfig, isClaimActive, resolveClaimState,
} from '../src/lib/rules/claim-logic'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

const NOW = Date.parse('2026-07-29T12:00:00-05:00')
const MIN = 60_000

// --- parseClaimConfig ---
assert('defaults cuando no hay config', JSON.stringify(parseClaimConfig(null)) === JSON.stringify(CLAIM_DEFAULTS))
assert('defaults cuando falta la clave claim', JSON.stringify(parseClaimConfig({ otra: 1 })) === JSON.stringify(CLAIM_DEFAULTS))
assert('lee enabled=false', parseClaimConfig({ claim: { enabled: false } }).enabled === false)
assert('lee mode=hard', parseClaimConfig({ claim: { mode: 'hard' } }).mode === 'hard')
assert('mode inválido cae a soft', parseClaimConfig({ claim: { mode: 'xxx' } }).mode === 'soft')
assert('lee expiry_minutes', parseClaimConfig({ claim: { expiry_minutes: 5 } }).expiryMinutes === 5)
assert('expiry inválido/0 cae a default 10', parseClaimConfig({ claim: { expiry_minutes: 0 } }).expiryMinutes === 10)

// --- isClaimActive ---
assert('null claimed_at → inactivo', isClaimActive(null, 10, NOW) === false)
assert('hace 5 min con expiry 10 → activo', isClaimActive(new Date(NOW - 5 * MIN).toISOString(), 10, NOW) === true)
assert('hace 15 min con expiry 10 → vencido', isClaimActive(new Date(NOW - 15 * MIN).toISOString(), 10, NOW) === false)
assert('justo en el borde (10 min) → vencido', isClaimActive(new Date(NOW - 10 * MIN).toISOString(), 10, NOW) === false)

// --- resolveClaimState ---
const active5 = new Date(NOW - 5 * MIN).toISOString()
const expired15 = new Date(NOW - 15 * MIN).toISOString()
assert('libre cuando claimed_by null', resolveClaimState({ claimed_by: null, claimed_by_name: null, claimed_at: null }, 'me', 10, NOW).state === 'free')
assert('libre cuando vencida', resolveClaimState({ claimed_by: 'otro', claimed_by_name: 'Ana', claimed_at: expired15 }, 'me', 10, NOW).state === 'free')
assert('mía cuando claimed_by===yo y vigente', resolveClaimState({ claimed_by: 'me', claimed_by_name: 'Yo', claimed_at: active5 }, 'me', 10, NOW).state === 'mine')
const others = resolveClaimState({ claimed_by: 'otro', claimed_by_name: 'Ana', claimed_at: active5 }, 'me', 10, NOW)
assert('de otra cuando vigente y ajena', others.state === 'others' && others.byName === 'Ana')
assert('heldMinutes calculado', others.heldMinutes === 5)
assert('claim huérfano (nombre sin ID) → free', resolveClaimState(
  { claimed_by: null, claimed_by_name: 'Ana', claimed_at: active5 }, 'me', 10, NOW,
).state === 'free')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
