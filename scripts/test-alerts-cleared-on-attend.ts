/**
 * Candado: atender (resolver/reabrir/devolver-al-agente) NUNCA limpia la alerta
 * de crisis ni la de derechos ARCO. Son no-limpiables por diseño.
 * Run: npx tsx scripts/test-alerts-cleared-on-attend.ts
 */
import { ALERTS_CLEARED_ON_ATTEND } from '../src/lib/notifications/escalation-notify'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void { if (ok) { console.log(`  ✅ ${label}`); pass++ } else { console.log(`  ❌ ${label}`); fail++ } }

console.log('Tests — ALERTS_CLEARED_ON_ATTEND excluye crisis/ARCO\n')

const set = ALERTS_CLEARED_ON_ATTEND as readonly string[]
assert('NO limpia crisis_detected (🆘 no-limpiable)', !set.includes('crisis_detected'))
assert('NO limpia data_rights_request (ARCO no-limpiable)', !set.includes('data_rights_request'))
assert('SÍ limpia conversation_escalated (escalación genérica)', set.includes('conversation_escalated'))
assert('el set es exactamente [conversation_escalated] (nada de más)', set.length === 1 && set[0] === 'conversation_escalated')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
