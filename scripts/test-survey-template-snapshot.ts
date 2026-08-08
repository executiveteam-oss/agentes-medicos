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
import { TEMPLATE_LANGUAGE } from '../src/lib/whatsapp/appointment-templates'
import {
  SURVEY_MESSAGE_TEMPLATE,
  buildSurveyMessage,
  buildSurveyTemplateArgs,
  SURVEY_CONFIG_DEFAULTS,
  SURVEY_BUTTON_URL_SUFFIX,
} from '../src/lib/rules/survey-config'

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

console.log('\nConsistencia manual ↔ template Meta (wording debe coincidir)')

test('SURVEY_MESSAGE_TEMPLATE (manual) normalizado = TEMPLATE_BODY_TEXT (Meta)', () => {
  // El helper del envío manual y el template Meta DEBEN decir lo MISMO.
  // Solo difieren los placeholders: manual usa {firstName}/{clinicName}, Meta usa {{1}}/{{2}}.
  const manualNormalized = SURVEY_MESSAGE_TEMPLATE
    .replace('{firstName}', '{{1}}')
    .replace('{clinicName}', '{{2}}')
  assertEq(manualNormalized, TEMPLATE_BODY_TEXT, 'Wording divergente — sincronizar SURVEY_MESSAGE_TEMPLATE y TEMPLATE_BODY_TEXT')
})

test('buildSurveyMessage produce texto = body renderizado + \\n\\n + URL', () => {
  const msg = buildSurveyMessage({
    patientFirstName: 'María',
    clinicDisplayName: 'Algia',
    formUrl: 'https://forms.gle/xxx',
  })
  const expectedBody = TEMPLATE_BODY_TEXT.replace('{{1}}', 'María').replace('{{2}}', 'Algia')
  assertEq(msg, `${expectedBody}\n\nhttps://forms.gle/xxx`, 'Manual concatena bien')
})



// ============================================================
// REGRESIÓN: los dos caminos de envío deben producir argumentos IDÉNTICOS.
//
// Se agregó después de encontrar que ya habían divergido: el cron mandaba el
// idioma 'es_CO' y el envío inmediato 'es'. Con el template aprobado en
// Spanish (COL), TODO envío inmediato habría fallado con 132001 — invisible,
// porque va dentro de after() — y el cron lo habría tapado una hora después.
// ============================================================
test('buildSurveyTemplateArgs: idioma = el de los demás templates (es_CO)', () => {
  const args = buildSurveyTemplateArgs({
    cfg: { ...SURVEY_CONFIG_DEFAULTS, template_name: 'encuesta_satisfaccion', form_url: 'https://x.co/f' },
    clinicName: 'ALGIA',
    patient: { name: 'JUAN LONDOÑO', first_name: null },
  })
  assertEq(args.languageCode, TEMPLATE_LANGUAGE, 'Idioma divergente del resto de los templates')
  assertEq(args.languageCode, 'es_CO', 'El template está aprobado en Spanish (COL)')
})

test('buildSurveyTemplateArgs: el botón lleva el SUFIJO, nunca una URL', () => {
  const args = buildSurveyTemplateArgs({
    cfg: { ...SURVEY_CONFIG_DEFAULTS, template_name: 't', form_url: 'https://docs.google.com/forms/d/e/XYZ/viewform' },
    clinicName: 'ALGIA',
    patient: { name: 'Ana Pérez', first_name: null },
  })
  assertEq(args.buttonParam, SURVEY_BUTTON_URL_SUFFIX, 'El parámetro del botón cambió')
  if (args.buttonParam.startsWith('http')) {
    throw new Error('El parámetro del botón es una URL — Meta la concatena y la duplica')
  }
})

test('buildSurveyTemplateArgs: clinic_display_name pisa el nombre de la clínica', () => {
  const conNombre = buildSurveyTemplateArgs({
    cfg: { ...SURVEY_CONFIG_DEFAULTS, template_name: 't', form_url: 'https://x.co/f', clinic_display_name: 'ALGIA UNIDAD' },
    clinicName: 'ALGIA', patient: { name: 'Ana Pérez', first_name: null },
  })
  assertEq(conNombre.bodyParams[1], 'ALGIA UNIDAD', 'No respetó clinic_display_name')
  const sinNombre = buildSurveyTemplateArgs({
    cfg: { ...SURVEY_CONFIG_DEFAULTS, template_name: 't', form_url: 'https://x.co/f' },
    clinicName: 'ALGIA', patient: { name: 'Ana Pérez', first_name: null },
  })
  assertEq(sinNombre.bodyParams[1], 'ALGIA', 'No cayó al nombre de la clínica')
})


console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
