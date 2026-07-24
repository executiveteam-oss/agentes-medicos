import { buildContainmentMessage, DEFAULT_CRISIS_CONFIG, crisisConfigSchema } from '../src/lib/safety/crisis-config'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests Capa 0 — config de crisis\n')

assert('default: detection ON', DEFAULT_CRISIS_CONFIG.detection_enabled === true)
assert('default: auto_message NO aprobado', DEFAULT_CRISIS_CONFIG.auto_message_approved === false)
assert('default: contención menciona 106', DEFAULT_CRISIS_CONFIG.containment_message.includes('106'))
assert('default: contención menciona 123', DEFAULT_CRISIS_CONFIG.containment_message.includes('123'))

const msg = buildContainmentMessage(DEFAULT_CRISIS_CONFIG, 'Ana')
assert('interpola {nombre}', msg.includes('Ana') || !DEFAULT_CRISIS_CONFIG.containment_message.includes('{nombre}'))
assert('sin placeholder crudo', !msg.includes('{nombre}'))

const parsed = crisisConfigSchema.safeParse({
  detection_enabled: true, auto_message_approved: true,
  containment_message: 'texto', human_handoff_message: 'texto',
})
assert('zod acepta config válida', parsed.success === true)
const bad = crisisConfigSchema.safeParse({ detection_enabled: 'no' })
assert('zod rechaza config inválida', bad.success === false)

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
