/**
 * Tests unitarios para src/lib/rules/survey-config.ts
 * Run: npx tsx scripts/test-survey-config.ts
 */

import {
  SurveyConfigSchema,
  SURVEY_CONFIG_DEFAULTS,
  canSendSurvey,
  extractFirstName,
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

console.log('SurveyConfigSchema — parse')

test('Acepta config mínima (todo default)', () => {
  const parsed = SurveyConfigSchema.parse({})
  assert(parsed.enabled === false, 'enabled default false')
  assert(parsed.template_name === 'encuesta_satisfaccion', 'template_name default')
  assert(parsed.form_url === null, 'form_url default null')
  assert(parsed.guardrail_hours === 48, 'guardrail default 48h')
  assert(parsed.cron_frequency_minutes === 60, 'cron freq default 60min')
})

test('Acepta config completa válida', () => {
  const parsed = SurveyConfigSchema.parse({
    enabled: true,
    template_name: 'mi_template',
    form_url: 'https://forms.gle/abc',
    clinic_display_name: 'Clínica Test',
    guardrail_hours: 24,
    cron_frequency_minutes: 30,
  })
  assert(parsed.enabled === true, 'enabled true')
  assert(parsed.form_url === 'https://forms.gle/abc', 'form_url ok')
})

test('Rechaza form_url no-URL', () => {
  const r = SurveyConfigSchema.safeParse({ form_url: 'no-es-una-url' })
  assert(!r.success, 'Debería fallar')
})

test('Rechaza form_url string vacío (URL inválida)', () => {
  const r = SurveyConfigSchema.safeParse({ form_url: '' })
  assert(!r.success, 'string vacío no es URL')
})

test('Acepta form_url null', () => {
  const r = SurveyConfigSchema.safeParse({ form_url: null })
  assert(r.success, 'null es válido')
})

test('Rechaza guardrail_hours < 1', () => {
  const r = SurveyConfigSchema.safeParse({ guardrail_hours: 0 })
  assert(!r.success, '0 fuera de rango')
})

test('Rechaza guardrail_hours > 168 (1 semana)', () => {
  const r = SurveyConfigSchema.safeParse({ guardrail_hours: 200 })
  assert(!r.success, '200h fuera de rango')
})

test('Rechaza template_name vacío', () => {
  const r = SurveyConfigSchema.safeParse({ template_name: '' })
  assert(!r.success, 'template_name vacío no permitido')
})

test('Rechaza cron_frequency_minutes < 15', () => {
  const r = SurveyConfigSchema.safeParse({ cron_frequency_minutes: 5 })
  assert(!r.success, 'min 15 min')
})

test('clinic_display_name acepta null y string largo', () => {
  const nullR = SurveyConfigSchema.safeParse({ clinic_display_name: null })
  assert(nullR.success, 'null OK')
  const longR = SurveyConfigSchema.safeParse({
    clinic_display_name: 'ALGIA UNIDAD DE LAPAROSCOPIA GINECOLOGICA AVANZADA Y DOLOR PELVICO',
  })
  assert(longR.success, 'string largo OK dentro de 200 chars')
})

test('Rechaza clinic_display_name > 200 chars', () => {
  const r = SurveyConfigSchema.safeParse({ clinic_display_name: 'X'.repeat(201) })
  assert(!r.success, 'excede 200')
})

console.log('\ncanSendSurvey — runtime gates')

test('disabled → no envía con razón enabled', () => {
  const r = canSendSurvey(SURVEY_CONFIG_DEFAULTS)
  assert(!r.ok && r.reason.includes('deshabilitado'), 'reason menciona deshabilitado')
})

test('enabled pero sin form_url → no envía', () => {
  const cfg = { ...SURVEY_CONFIG_DEFAULTS, enabled: true }
  const r = canSendSurvey(cfg)
  assert(!r.ok && r.reason.includes('form_url'), 'reason menciona form_url')
})

test('enabled + form_url + template → OK', () => {
  const cfg = {
    ...SURVEY_CONFIG_DEFAULTS,
    enabled: true,
    form_url: 'https://forms.gle/xyz',
  }
  const r = canSendSurvey(cfg)
  assert(r.ok === true, 'OK')
})

console.log('\nextractFirstName')

test('Usa first_name si existe', () => {
  const r = extractFirstName({ first_name: 'MARIA', name: 'MARIA JOSE PEREZ' })
  assert(r === 'Maria', `got ${r}`)
})

test('Fallback a split de name si first_name null', () => {
  const r = extractFirstName({ first_name: null, name: 'LUZ ADRIANA JARAMILLO' })
  assert(r === 'Luz', `got ${r}`)
})

test('Fallback a "hola" si name vacío', () => {
  const r = extractFirstName({ first_name: null, name: '' })
  assert(r === 'hola', `got ${r}`)
})

test('Colapsa espacios múltiples ("LUZ  ADRIANA" del iSalud typo)', () => {
  const r = extractFirstName({ first_name: null, name: 'LUZ  ADRIANA' })
  assert(r === 'Luz', `got ${r}`)
})

test('first_name vacío string → fallback a name', () => {
  const r = extractFirstName({ first_name: '', name: 'SOFIA MARTINEZ' })
  assert(r === 'Sofia', `got ${r}`)
})

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
