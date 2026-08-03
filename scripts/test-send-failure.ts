// Tests — registro central de fallos de envío WhatsApp.
import { shouldAlertOnSendFailure, ALERT_ON_SEND_FAILURE, recordWhatsAppSendFailure } from '../src/lib/whatsapp/send-failure'

let ok = 0, fail = 0
function assert(name: string, cond: boolean) { if (cond) { ok++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }

async function main() {
  console.log('Decisión de ALERTA — constante, solo crisis\n')
  assert('constante = [crisis_containment]', ALERT_ON_SEND_FAILURE.length === 1 && ALERT_ON_SEND_FAILURE[0] === 'crisis_containment')
  assert('crisis_containment → ALERTA', shouldAlertOnSendFailure('crisis_containment') === true)
  assert('reminder → solo audit', shouldAlertOnSendFailure('reminder') === false)
  assert('ics → solo audit', shouldAlertOnSendFailure('ics') === false)
  assert('weekly_report → solo audit', shouldAlertOnSendFailure('weekly_report') === false)
  assert('agent_reply → solo audit', shouldAlertOnSendFailure('agent_reply') === false)
  assert('tipo desconocido → solo audit', shouldAlertOnSendFailure('lo_que_sea') === false)

  console.log('\nrecordWhatsAppSendFailure NUNCA tira (aunque el DB falle)\n')
  let threw = false
  try {
    // En este entorno el insert al DB falla (sin red) → debe caer al catch y resolver.
    await recordWhatsAppSendFailure({ clinicId: 'no-existe', sendType: 'reminder' }, { errorCode: 190, errorMessage: 'x' })
  } catch { threw = true }
  assert('no tira con audit fallando', threw === false)

  let threw2 = false
  try {
    await recordWhatsAppSendFailure({ clinicId: 'no-existe', sendType: 'crisis_containment', messageId: 'x', conversationId: 'y', patientName: 'Ana' }, {})
  } catch { threw2 = true }
  assert('no tira ni con la rama de alerta + delivery_status', threw2 === false)

  console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
  if (fail > 0) process.exit(1)
}
main()
