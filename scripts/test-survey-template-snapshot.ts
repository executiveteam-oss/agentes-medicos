/**
 * Snapshot del texto del template (BODY + botón).
 *
 * PROTECCIÓN CRÍTICA: si alguien edita el texto que la UI muestra a la
 * clínica para pegar en Meta Business Manager, el cambio genera dos
 * problemas silenciosos:
 *
 *  1. La plantilla que la clínica YA aprobó en Meta queda con el texto
 *     viejo — mismos nombres de variable ({{1}}, {{2}}) pero texto distinto.
 *     Meta acepta el envío pero muestra el texto VIEJO al paciente
 *     (porque Meta tiene su propia copia del texto aprobado).
 *
 *  2. Clínicas nuevas ven el texto NUEVO en la guía de onboarding,
 *     lo aprueban, y quedan con una plantilla DIFERENTE a las clínicas
 *     que aprobaron con el texto viejo. Fragmentación silenciosa.
 *
 * Si necesitás cambiar el texto:
 *  1. Coordinar aviso a todas las clínicas activas
 *  2. Cada clínica somete una NUEVA plantilla con el texto nuevo
 *  3. Actualizar este snapshot
 *  4. Después de aprobación, migrar template_name en Omuwan
 *
 * Run: npx tsx scripts/test-survey-template-snapshot.ts
 */

import {
  TEMPLATE_BODY_TEXT,
  TEMPLATE_BUTTON_TEXT,
  TEMPLATE_DEFAULT_NAME,
} from '../src/app/dashboard/settings/automations/survey/survey-form'

let pass = 0
let fail = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    pass++
  } catch (err) {
    console.log(`  ❌ ${name}`)
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
    fail++
  }
}

function assertEq(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}\n  esperado: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
  }
}

console.log('Template — snapshot del texto (protege contra edits sin coordinar con Meta)')

test('BODY del template no cambió', () => {
  const EXPECTED_BODY =
    'Buen día {{1}}. Sería tan amable de diligenciar la encuesta de satisfacción de {{2}}. Gracias por ayudarnos a mejorar nuestra atención.'
  assertEq(TEMPLATE_BODY_TEXT, EXPECTED_BODY, 'BODY divergente')
})

test('Texto del botón no cambió', () => {
  assertEq(TEMPLATE_BUTTON_TEXT, 'Responder encuesta', 'Botón texto divergente')
})

test('Nombre default del template no cambió', () => {
  assertEq(TEMPLATE_DEFAULT_NAME, 'encuesta_satisfaccion', 'Nombre default divergente')
})

test('BODY contiene exactamente 2 variables ({{1}} y {{2}})', () => {
  const matches = TEMPLATE_BODY_TEXT.match(/\{\{\d+\}\}/g) ?? []
  if (matches.length !== 2) throw new Error(`Esperaba 2 vars, encontré ${matches.length}: ${matches.join(', ')}`)
  if (matches[0] !== '{{1}}' || matches[1] !== '{{2}}') {
    throw new Error(`Orden de vars incorrecto: ${matches.join(', ')}`)
  }
})

test('BODY no supera 1024 chars (límite Meta)', () => {
  if (TEMPLATE_BODY_TEXT.length > 1024) throw new Error(`BODY tiene ${TEMPLATE_BODY_TEXT.length} chars`)
})

test('Texto del botón ≤ 25 chars (límite Meta)', () => {
  if (TEMPLATE_BUTTON_TEXT.length > 25) throw new Error(`Botón tiene ${TEMPLATE_BUTTON_TEXT.length} chars`)
})

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
