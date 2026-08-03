// Tests — fricción de "devolver al agente" (Etapa 3).
// La invariante "no toca la 🆘" está cubierta por test-alerts-cleared-on-attend.ts
// (returnConversationToAgent usa el MISMO resolveEscalationNotifications).
import { crisisReturnMissingReason } from '../src/lib/rules/return-to-agent'
import { ALERTS_CLEARED_ON_ATTEND } from '../src/lib/notifications/escalation-notify'

let ok = 0, fail = 0
function assert(name: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) }
}

console.log('Fricción: crisis exige motivo; los demás no\n')
assert('crisis SIN motivo → rechaza', crisisReturnMissingReason('crisis', undefined) === true)
assert('crisis con motivo vacío → rechaza', crisisReturnMissingReason('crisis', '   ') === true)
assert('crisis con motivo → OK', crisisReturnMissingReason('crisis', 'ya la llamé, está estable') === false)
assert('servicio ruleado SIN motivo → OK (liviano)', crisisReturnMissingReason('servicio_escalate_human', undefined) === false)
assert('ARCO SIN motivo → OK (liviano)', crisisReturnMissingReason('data_rights_request', undefined) === false)
assert('pedido_humano SIN motivo → OK', crisisReturnMissingReason('pedido_humano', undefined) === false)
assert('sin motivo de escalación SIN motivo → OK', crisisReturnMissingReason(null, undefined) === false)

console.log('\nDevolver NO toca la 🆘 (misma garantía que Resuelta)\n')
const set = ALERTS_CLEARED_ON_ATTEND as readonly string[]
assert('devolver no limpia crisis_detected', !set.includes('crisis_detected'))
assert('devolver no limpia data_rights_request', !set.includes('data_rights_request'))
assert('devolver SÍ limpia conversation_escalated', set.includes('conversation_escalated'))

console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
if (fail > 0) process.exit(1)
