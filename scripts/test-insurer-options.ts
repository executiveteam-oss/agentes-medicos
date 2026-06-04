/**
 * Tests de la lista centralizada de aseguradoras + helpers.
 * Run: npx tsx scripts/test-insurer-options.ts
 *
 * NO requiere DB ni red — funciones puras.
 */

import {
  INSURER_OPTIONS,
  findInsurer,
  normalizeInsurerInput,
  getInsurerNamesByType,
  ALL_INSURER_NAMES,
} from '../src/lib/utils/insurer-options'
import { EPS_OPTIONS } from '../src/lib/utils/eps-options'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

console.log('🧪 Tests insurer-options')
console.log('=========================\n')

console.log('--- Normalización ---')
assert('lowercase + trim', normalizeInsurerInput('  COOMEVA  ') === 'coomeva')
assert('quita tildes', normalizeInsurerInput('Colmédica') === 'colmedica')
assert('colapsa espacios', normalizeInsurerInput('axa  colpatria') === 'axa colpatria')
assert('vacío → vacío', normalizeInsurerInput('') === '')

console.log('\n--- findInsurer: ambiguas (Sura, Sanitas) ---')
{
  const r = findInsurer('Sura')
  assert('Sura → ambigua', r?.name === 'Sura' && r?.type === 'ambigua' && r?.hasAmbiguity === true)
}
{
  const r = findInsurer('suramericana')
  assert('"suramericana" → Sura ambigua', r?.name === 'Sura')
}
{
  const r = findInsurer('SANITAS')
  assert('Sanitas uppercase → ambigua', r?.name === 'Sanitas' && r?.hasAmbiguity === true)
}

console.log('\n--- findInsurer: solo Prepagada ---')
{
  const r = findInsurer('coomeva')
  assert('Coomeva → solo Prepagada (EPS liquidada)', r?.type === 'Prepagada' && r?.hasAmbiguity === false)
}
{
  const r = findInsurer('coomeva prepagada')
  assert('"coomeva prepagada" alias OK', r?.name === 'Coomeva Prepagada')
}
{
  const r = findInsurer('colsanitas')
  assert('Colsanitas → Prepagada', r?.type === 'Prepagada')
}
{
  const r = findInsurer('Colmédica')
  assert('Colmédica con tilde → match', r?.name === 'Colmédica')
}
{
  const r = findInsurer('axa colpatria')
  assert('AXA Colpatria → Prepagada', r?.type === 'Prepagada')
}
{
  const r = findInsurer('Allianz')
  assert('Allianz → solo Prepagada (default)', r?.name === 'Allianz Salud' && r?.hasAmbiguity === false)
}
{
  const r = findInsurer('allianz seguros de vida')
  assert('Allianz Seguros de Vida (alias razón social) → match', r?.name === 'Allianz Salud')
}

console.log('\n--- findInsurer: solo EPS ---')
{
  const r = findInsurer('Nueva EPS')
  assert('Nueva EPS → solo EPS', r?.type === 'EPS' && r?.hasAmbiguity === false)
}
{
  const r = findInsurer('compensar')
  assert('Compensar → EPS', r?.type === 'EPS')
}
{
  const r = findInsurer('famisanar')
  assert('Famisanar → EPS', r?.type === 'EPS')
}

console.log('\n--- findInsurer: NO match ---')
assert('"asdfg" → null', findInsurer('asdfg') === null)
assert('"" → null', findInsurer('') === null)
assert('"medimás" → null (excluida, liquidada 2019)', findInsurer('medimás') === null)
assert('"medimas" → null', findInsurer('medimas') === null)

console.log('\n--- getInsurerNamesByType ---')
{
  const eps = getInsurerNamesByType('EPS')
  // EPS list incluye solo-EPS + ambiguas (Sura, Sanitas)
  assert('EPS incluye Nueva EPS', eps.includes('Nueva EPS'))
  assert('EPS incluye Sura (ambigua)', eps.includes('Sura'))
  assert('EPS incluye Sanitas (ambigua)', eps.includes('Sanitas'))
  assert('EPS NO incluye Coomeva Prepagada', !eps.includes('Coomeva Prepagada'))
  assert('EPS NO incluye Allianz Salud', !eps.includes('Allianz Salud'))
}
{
  const prep = getInsurerNamesByType('Prepagada')
  assert('Prepagada incluye Coomeva Prepagada', prep.includes('Coomeva Prepagada'))
  assert('Prepagada incluye Allianz Salud', prep.includes('Allianz Salud'))
  assert('Prepagada incluye Sura (ambigua)', prep.includes('Sura'))
  assert('Prepagada NO incluye Nueva EPS', !prep.includes('Nueva EPS'))
}

console.log('\n--- Compatibilidad EPS_OPTIONS (re-export) ---')
assert('EPS_OPTIONS termina con "Otra"', EPS_OPTIONS[EPS_OPTIONS.length - 1] === 'Otra')
assert('EPS_OPTIONS incluye Sura', (EPS_OPTIONS as readonly string[]).includes('Sura'))
assert('EPS_OPTIONS incluye Coomeva Prepagada', (EPS_OPTIONS as readonly string[]).includes('Coomeva Prepagada'))
assert('EPS_OPTIONS NO incluye Medimás (excluida)', !(EPS_OPTIONS as readonly string[]).includes('Medimás'))

console.log('\n--- ALL_INSURER_NAMES ---')
assert('Tiene 17 aseguradoras', ALL_INSURER_NAMES.length === 17)
assert('No tiene "Otra" (eso vive solo en EPS_OPTIONS compat)', !(ALL_INSURER_NAMES as readonly string[]).includes('Otra'))

console.log('\n--- Cobertura: cada aseguradora tiene al menos 1 alias ---')
for (const opt of INSURER_OPTIONS) {
  assert(`${opt.name}: aliases.length ≥ 1`, opt.aliases.length >= 1)
}

console.log(`\n${passed} pasaron · ${failed} fallaron`)
if (failed > 0) process.exit(1)
