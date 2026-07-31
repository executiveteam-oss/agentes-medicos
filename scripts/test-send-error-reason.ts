/**
 * Tests — motivo de fallo de envío en lenguaje claro (sin código).
 * Run: npx tsx scripts/test-send-error-reason.ts
 */
import { whatsappSendErrorReason } from '../src/lib/whatsapp/send-error-reason'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void { if (ok) { console.log(`  ✅ ${label}`); pass++ } else { console.log(`  ❌ ${label}`); fail++ } }

console.log('Tests — whatsappSendErrorReason\n')

assert('131030 → habla de autorización/Test Number (no el código)', /autorizado|Test Number/i.test(whatsappSendErrorReason(131030)) && !whatsappSendErrorReason(131030).includes('131030'))
assert('190 → token venció', /token.*venc/i.test(whatsappSendErrorReason(190)))
assert('131047 → ventana 24h', /24 horas/i.test(whatsappSendErrorReason(131047)))
assert('131026 → sin WhatsApp/dado de baja', /no tiene WhatsApp|no puede recibir/i.test(whatsappSendErrorReason(131026)))
assert('código desconocido → muestra el número', whatsappSendErrorReason(999999).includes('999999'))
assert('sin código (red) → falla de conexión', /conexión/i.test(whatsappSendErrorReason(undefined)))
assert('null → falla de conexión', /conexión/i.test(whatsappSendErrorReason(null)))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
