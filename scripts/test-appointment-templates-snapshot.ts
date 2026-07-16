// scripts/test-appointment-templates-snapshot.ts
// Congela el wording de los templates de recordatorio/cancelación para que
// nadie los edite sin re-aprobar en Meta. Valida también las reglas de Meta
// (variable no al inicio/final del body, límites de longitud, conteo de vars).
import {
  REMINDER_TEMPLATE_NAME, REMINDER_TEMPLATE_BODY, REMINDER_BUTTONS,
  CANCEL_TEMPLATE_NAME, CANCEL_TEMPLATE_BODY, CANCEL_BUTTON,
  TEMPLATE_LANGUAGE,
} from '../src/lib/whatsapp/appointment-templates'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

function countVars(body: string): number {
  return (body.match(/\{\{\d+\}\}/g) ?? []).length
}
// Meta rechaza variable como primer o último "token" del body.
function endsWithVariable(body: string): boolean {
  return /\{\{\d+\}\}\s*$/.test(body.trim())
}
function startsWithVariable(body: string): boolean {
  return /^\s*\{\{\d+\}\}/.test(body.trim())
}

console.log('Snapshot templates de cita\n')

// --- Snapshot exacto (si cambia, hay que re-aprobar en Meta) ---
assert('language es es_CO', TEMPLATE_LANGUAGE === 'es_CO')
assert('nombre recordatorio', REMINDER_TEMPLATE_NAME === 'recordatorio_cita')
assert('nombre cancelación', CANCEL_TEMPLATE_NAME === 'cancelacion_cita')

assert(
  'body recordatorio EXACTO (cierra con "Te esperamos.")',
  REMINDER_TEMPLATE_BODY === 'Hola {{1}} 👋 Te recordamos tu cita con {{2}} el {{3}} a las {{4}}.\n📍 {{5}}\nTe esperamos.',
  JSON.stringify(REMINDER_TEMPLATE_BODY),
)
assert(
  'body cancelación EXACTO',
  CANCEL_TEMPLATE_BODY === 'Hola {{1}} 👋 Lamentamos informarte que tu cita con {{2}} del {{3}} a las {{4}} fue cancelada {{5}}. Queremos reagendarte lo antes posible.',
  JSON.stringify(CANCEL_TEMPLATE_BODY),
)

// --- Reglas de Meta ---
assert('recordatorio: 5 variables', countVars(REMINDER_TEMPLATE_BODY) === 5, `${countVars(REMINDER_TEMPLATE_BODY)}`)
assert('cancelación: 5 variables', countVars(CANCEL_TEMPLATE_BODY) === 5, `${countVars(CANCEL_TEMPLATE_BODY)}`)

assert('recordatorio NO empieza con variable', !startsWithVariable(REMINDER_TEMPLATE_BODY))
assert('recordatorio NO termina con variable', !endsWithVariable(REMINDER_TEMPLATE_BODY))
assert('cancelación NO empieza con variable', !startsWithVariable(CANCEL_TEMPLATE_BODY))
assert('cancelación NO termina con variable', !endsWithVariable(CANCEL_TEMPLATE_BODY))

assert('recordatorio body ≤ 1024', REMINDER_TEMPLATE_BODY.length <= 1024)
assert('cancelación body ≤ 1024', CANCEL_TEMPLATE_BODY.length <= 1024)

// --- Botones ---
assert('recordatorio tiene 3 botones', REMINDER_BUTTONS.length === 3)
assert('botones ≤ 25 chars', [...REMINDER_BUTTONS, CANCEL_BUTTON].every((b) => b.length <= 25))
assert('botones recordatorio = Confirmar/Reagendar/Cancelar',
  REMINDER_BUTTONS.join(',') === 'Confirmar,Reagendar,Cancelar')
assert('botón cancelación = Reagendar', CANCEL_BUTTON === 'Reagendar')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
