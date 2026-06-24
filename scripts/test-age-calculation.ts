/**
 * Tests puros del cálculo de edad. Sin DB ni LLM.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-age-calculation.ts
 */

import { calculateAgeFromBirthDate } from '../src/lib/utils/age'

let passed = 0
let failed = 0
function assert(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label} — esperado ${JSON.stringify(expected)}, recibí ${JSON.stringify(actual)}`); failed++ }
}

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Tests cálculo de edad (calculateAgeFromBirthDate)')
  console.log('═══════════════════════════════════════════════════════════════')

  // Fecha fija "hoy" para reproducibilidad: 2026-06-24
  const today = new Date('2026-06-24T12:00:00-05:00')

  console.log('\n=== Casos básicos ===')
  assert('Nacido hace exactamente 30 años → 30',
    calculateAgeFromBirthDate('1996-06-24', today), 30)
  assert('Nacido hace 30 años + 1 día (cumplió ayer) → 30',
    calculateAgeFromBirthDate('1996-06-23', today), 30)
  assert('Nacido hace 30 años - 1 día (cumple mañana) → 29',
    calculateAgeFromBirthDate('1996-06-25', today), 29)

  console.log('\n=== Cumpleaños este año todavía no llegó ===')
  assert('Cumple en diciembre, hoy junio → edad-1',
    calculateAgeFromBirthDate('2008-12-30', today), 17)
  assert('Cumple en julio (próximo mes) → aún tiene 17',
    calculateAgeFromBirthDate('2008-07-15', today), 17)

  console.log('\n=== Cumpleaños este año ya pasó ===')
  assert('Cumple en mayo (mes pasado) → ya cumplió',
    calculateAgeFromBirthDate('2008-05-15', today), 18)
  assert('Cumple en enero (hace meses) → ya cumplió',
    calculateAgeFromBirthDate('2008-01-15', today), 18)

  console.log('\n=== Casos borde de leap year ===')
  // Nacidos el 29 de febrero: en años no-bisiestos, "cumplen" el 1 de marzo
  // según la convención común. date-fns differenceInYears trata el 29-feb
  // como su propio día — verificamos comportamiento real.
  assert('Nacido 2004-02-29, hoy 2026-06-24 → 22',
    calculateAgeFromBirthDate('2004-02-29', today), 22)

  console.log('\n=== Pacientes menores (casos Algia bloque 2) ===')
  assert('Bebé de 1 año',
    calculateAgeFromBirthDate('2025-04-01', today), 1)
  assert('Niño de 12',
    calculateAgeFromBirthDate('2013-12-30', today), 12)
  assert('Adolescente 16 — debajo del mínimo de Mapeo (18)',
    calculateAgeFromBirthDate('2009-12-30', today), 16)

  console.log('\n=== Pacientes mayores (casos Algia bloque 2) ===')
  assert('Adulto 50 — borde alto de Mapeo',
    calculateAgeFromBirthDate('1976-06-23', today), 50)
  assert('Adulto 51 — sobre el máximo',
    calculateAgeFromBirthDate('1975-06-23', today), 51)
  assert('Adulto mayor 75',
    calculateAgeFromBirthDate('1951-06-23', today), 75)

  console.log('\n=== Entradas inválidas → null ===')
  assert('null → null',
    calculateAgeFromBirthDate(null, today), null)
  assert('undefined → null',
    calculateAgeFromBirthDate(undefined, today), null)
  assert('string vacío → null',
    calculateAgeFromBirthDate('', today), null)
  assert('texto no fecha → null',
    calculateAgeFromBirthDate('no-es-fecha', today), null)
  assert('fecha futura → null',
    calculateAgeFromBirthDate('2030-01-01', today), null)
  assert('año 1800 (anterior a 1900) → null',
    calculateAgeFromBirthDate('1800-06-01', today), null)
  assert('mes inválido (mes 13) → null',
    calculateAgeFromBirthDate('1990-13-01', today), null)

  console.log('\n=== Recién nacido hoy mismo ===')
  assert('Nacido hoy → 0',
    calculateAgeFromBirthDate('2026-06-24', today), 0)

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main()
