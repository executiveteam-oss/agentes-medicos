// scripts/test-appointment-templates-snapshot.ts
// Congela el wording de los templates de recordatorio/cancelación para que
// nadie los edite sin re-aprobar en Meta. Valida también las reglas de Meta
// (variable no al inicio/final del body, límites de longitud, conteo de vars).
import {
  REMINDER_TEMPLATE_NAME, REMINDER_TEMPLATE_BODY, REMINDER_BUTTONS,
  REMINDER_TEMPLATE_NAME_V2, REMINDER_TEMPLATE_BODY_V2,
  CANCEL_TEMPLATE_NAME, CANCEL_TEMPLATE_BODY, CANCEL_BUTTON,
  ORDEN_TEMPLATE_NAME, ORDEN_TEMPLATE_BODY,
  CONTACTO_TEMPLATE_NAME, CONTACTO_TEMPLATE_BODY,
  REAGENDA_TEMPLATE_NAME, REAGENDA_TEMPLATE_BODY,
  RESUMEN_TEMPLATE_NAME, RESUMEN_TEMPLATE_BODY,
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
// V1: MUERTA (ver appointment-templates.ts). Se congela el wording, no se envía.
assert('nombre recordatorio V1 (muerta)', REMINDER_TEMPLATE_NAME === 'recordatorio_cita')
assert('nombre cancelación', CANCEL_TEMPLATE_NAME === 'cancelacion_cita')

assert(
  'body recordatorio EXACTO (cierra con "Te esperamos.")',
  REMINDER_TEMPLATE_BODY === 'Hola {{1}} 👋 Te recordamos tu cita con {{2}} el {{3}} a las {{4}}.\n📍 {{5}}\nTe esperamos.',
  JSON.stringify(REMINDER_TEMPLATE_BODY),
)
assert(
  'body cancelación EXACTO',
  CANCEL_TEMPLATE_BODY === 'Hola {{1}} 👋 Lamentamos informarte que tu cita con {{2}} del {{3}} a las {{4}} fue cancelada. Motivo: {{5}}. Queremos reagendarte lo antes posible.',
  JSON.stringify(CANCEL_TEMPLATE_BODY),
)

// --- Reglas de Meta ---
assert('nombre resumen', RESUMEN_TEMPLATE_NAME === 'resumen_diario_medico')
assert(
  'body resumen EXACTO',
  RESUMEN_TEMPLATE_BODY === 'Buenos días, {{1}} 👋 Estas son sus citas de hoy: {{2}}. Que tenga un buen día.',
  JSON.stringify(RESUMEN_TEMPLATE_BODY),
)

assert('recordatorio: 5 variables', countVars(REMINDER_TEMPLATE_BODY) === 5, `${countVars(REMINDER_TEMPLATE_BODY)}`)

// Recordatorio V2 (nombra a la clínica). Protege contra editar el body sin
// re-someter a Meta. {{2}} = clínica → 6 variables.
assert('nombre recordatorio v2', REMINDER_TEMPLATE_NAME_V2 === 'recordatorio_cita_v2')
assert(
  'body recordatorio v2 (nombra a la clínica en {{2}})',
  REMINDER_TEMPLATE_BODY_V2 === 'Hola {{1}} 👋 Te escribimos de {{2}}. Te recordamos tu cita con {{3}} el {{4}} a las {{5}}.\n📍 {{6}}\nTe esperamos.',
  JSON.stringify(REMINDER_TEMPLATE_BODY_V2),
)
assert('recordatorio v2: 6 variables', countVars(REMINDER_TEMPLATE_BODY_V2) === 6, `${countVars(REMINDER_TEMPLATE_BODY_V2)}`)
assert('cancelación: 5 variables', countVars(CANCEL_TEMPLATE_BODY) === 5, `${countVars(CANCEL_TEMPLATE_BODY)}`)
assert('resumen: 2 variables', countVars(RESUMEN_TEMPLATE_BODY) === 2, `${countVars(RESUMEN_TEMPLATE_BODY)}`)

assert('recordatorio NO empieza con variable', !startsWithVariable(REMINDER_TEMPLATE_BODY))
assert('recordatorio NO termina con variable', !endsWithVariable(REMINDER_TEMPLATE_BODY))
assert('cancelación NO empieza con variable', !startsWithVariable(CANCEL_TEMPLATE_BODY))
assert('cancelación NO termina con variable', !endsWithVariable(CANCEL_TEMPLATE_BODY))
assert('resumen NO empieza con variable', !startsWithVariable(RESUMEN_TEMPLATE_BODY))
assert('resumen NO termina con variable', !endsWithVariable(RESUMEN_TEMPLATE_BODY))
assert('resumen body ≤ 1024', RESUMEN_TEMPLATE_BODY.length <= 1024)

assert('recordatorio body ≤ 1024', REMINDER_TEMPLATE_BODY.length <= 1024)
assert('cancelación body ≤ 1024', CANCEL_TEMPLATE_BODY.length <= 1024)

// --- Botones ---
assert('recordatorio tiene 3 botones', REMINDER_BUTTONS.length === 3)
assert('botones ≤ 25 chars', [...REMINDER_BUTTONS, CANCEL_BUTTON].every((b) => b.length <= 25))
assert('botones recordatorio = Confirmar/Reagendar/Cancelar',
  REMINDER_BUTTONS.join(',') === 'Confirmar,Reagendar,Cancelar')
assert('botón cancelación = Reagendar', CANCEL_BUTTON === 'Reagendar')

// --- Orden médica y contacto general ---
assert('nombre orden médica', ORDEN_TEMPLATE_NAME === 'solicitud_orden_medica')
assert('orden: 5 variables', countVars(ORDEN_TEMPLATE_BODY) === 5, `${countVars(ORDEN_TEMPLATE_BODY)}`)
assert('orden NO empieza con variable', !startsWithVariable(ORDEN_TEMPLATE_BODY))
assert('orden NO termina con variable', !endsWithVariable(ORDEN_TEMPLATE_BODY))
assert('orden body ≤ 1024', ORDEN_TEMPLATE_BODY.length <= 1024)
assert('orden habla EN PASADO de la cita', /Sobre tu cita del/.test(ORDEN_TEMPLATE_BODY))
assert('orden nombra a la clínica', ORDEN_TEMPLATE_BODY.includes('Te escribimos de {{2}}'))

assert('nombre contacto general', CONTACTO_TEMPLATE_NAME === 'contacto_general')
assert('contacto: 3 variables', countVars(CONTACTO_TEMPLATE_BODY) === 3, `${countVars(CONTACTO_TEMPLATE_BODY)}`)
assert('contacto NO empieza con variable', !startsWithVariable(CONTACTO_TEMPLATE_BODY))
assert('contacto NO termina con variable', !endsWithVariable(CONTACTO_TEMPLATE_BODY))
assert('contacto body ≤ 1024', CONTACTO_TEMPLATE_BODY.length <= 1024)
assert('contacto: el motivo va en su PROPIA línea', /:\n\{\{3\}\}/.test(CONTACTO_TEMPLATE_BODY))

assert('nombre reagendamiento', REAGENDA_TEMPLATE_NAME === 'reagendamiento_cita')
assert('reagenda: 7 variables', countVars(REAGENDA_TEMPLATE_BODY) === 7, `${countVars(REAGENDA_TEMPLATE_BODY)}`)
assert('reagenda NO empieza con variable', !startsWithVariable(REAGENDA_TEMPLATE_BODY))
// El link ({{7}}) quedaba último y Meta lo rechaza: cierra con "Te esperamos."
assert('reagenda NO termina con variable', !endsWithVariable(REAGENDA_TEMPLATE_BODY))
assert('reagenda body ≤ 1024', REAGENDA_TEMPLATE_BODY.length <= 1024)
assert('reagenda dice que la cita se MOVIÓ', /reprogramada/.test(REAGENDA_TEMPLATE_BODY))
assert('reagenda nombra a la clínica', REAGENDA_TEMPLATE_BODY.includes('Te escribimos de {{2}}'))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
