/**
 * Tests para buildSurveyMessage + consistencia manual↔template Meta.
 * Run: npx tsx scripts/test-survey-message-builder.ts
 */

import { buildSurveyMessage, SURVEY_MESSAGE_TEMPLATE } from '../src/lib/rules/survey-config'
import { TEMPLATE_BODY_TEXT } from '../src/app/dashboard/settings/automations/survey/survey-form'

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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

console.log('buildSurveyMessage')

test('Sustituye firstName y clinicName + concatena URL con \\n\\n', () => {
  const msg = buildSurveyMessage({
    patientFirstName: 'María',
    clinicDisplayName: 'Algia',
    formUrl: 'https://forms.gle/abc123',
  })
  const expected =
    'Buen día María. Sería tan amable de diligenciar la encuesta de satisfacción de Algia. Gracias por ayudarnos a mejorar nuestra atención.\n\nhttps://forms.gle/abc123'
  assert(msg === expected, `got:\n${msg}\nexpected:\n${expected}`)
})

test('Nombre clínica largo (Algia caso real) se sustituye entero', () => {
  const msg = buildSurveyMessage({
    patientFirstName: 'Luz',
    clinicDisplayName: 'ALGIA UNIDAD DE LAPAROSCOPIA GINECOLOGICA AVANZADA Y DOLOR PELVICO',
    formUrl: 'https://forms.gle/xyz',
  })
  assert(msg.includes('ALGIA UNIDAD DE LAPAROSCOPIA GINECOLOGICA AVANZADA Y DOLOR PELVICO'), 'nombre completo')
})

test('URL de Typeform también encaja sin issues', () => {
  const msg = buildSurveyMessage({
    patientFirstName: 'Ana',
    clinicDisplayName: 'Otra Clínica',
    formUrl: 'https://tally.so/r/wLKMXo',
  })
  assert(msg.endsWith('https://tally.so/r/wLKMXo'), 'URL al final')
})

test('URL con query params se preserva', () => {
  const msg = buildSurveyMessage({
    patientFirstName: 'Sofía',
    clinicDisplayName: 'Clínica',
    formUrl: 'https://forms.gle/x?a=1&b=2',
  })
  assert(msg.includes('?a=1&b=2'), 'query params preservados')
})

console.log('\nConsistencia manual ↔ template Meta')

test('El wording base es idéntico entre manual y template', () => {
  // Manual usa placeholders con nombres. Template usa {{1}}, {{2}}.
  // Substituimos placeholders manual con {{1}}, {{2}} para comparar directo.
  const manualNormalized = SURVEY_MESSAGE_TEMPLATE
    .replace('{firstName}', '{{1}}')
    .replace('{clinicName}', '{{2}}')

  assert(
    manualNormalized === TEMPLATE_BODY_TEXT,
    `Wording divergente\n  manual: "${manualNormalized}"\n  template: "${TEMPLATE_BODY_TEXT}"\n\nSi editaste uno de los dos SIN el otro, la paciente recibirá\ntextos distintos según el canal de envío. Sincronizalos.`,
  )
})

test('Manual concatena URL después de \\n\\n', () => {
  const msg = buildSurveyMessage({
    patientFirstName: 'x',
    clinicDisplayName: 'y',
    formUrl: 'https://z',
  })
  const parts = msg.split('\n\n')
  assert(parts.length === 2, 'exactamente 2 párrafos separados por \\n\\n')
  assert(parts[1] === 'https://z', 'segundo párrafo es la URL sola')
})

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
