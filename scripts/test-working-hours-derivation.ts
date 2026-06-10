/**
 * Tests para src/lib/isalud/working-hours-derivation.ts
 *
 * 26 tests sobre lógica pura:
 *   Suite 1 (15): deriveWeeklyPattern — derivación del patrón semanal
 *   Suite 2 (8):  isDefaultWorkingHours — detección de default bit-exact
 *   Suite 3 (3):  Casos sintéticos basados en datos reales de Algia
 *
 * Run: npx tsx scripts/test-working-hours-derivation.ts
 */

import {
  deriveWeeklyPattern,
  isDefaultWorkingHours,
  hashBlocks,
  type DerivationResult,
  type WeekdayKey,
} from '../src/lib/isalud/working-hours-derivation'
import type { ISaludDisponibilidadSlot } from '../src/lib/isalud/adapter'

// --- Test runner mínimo ---

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
  } catch (err) {
    failed++
    const msg = err instanceof Error ? err.message : String(err)
    failures.push(`  ❌ ${name}\n     ${msg}`)
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${label}\n     expected: ${e}\n     actual:   ${a}`)
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// --- Helpers para construir slots sintéticos ---

function slot(dia_semana: number, hora_inicio: string, hora_fin: string, fecha: string): ISaludDisponibilidadSlot {
  return { dia_semana, hora_inicio, hora_fin, fecha }
}

// Genera una serie de slots para mismo weekday a N fechas distintas.
function weeklySlots(
  dia_semana: number,
  blocks: Array<{ start: string; end: string }>,
  fechas: string[],
): ISaludDisponibilidadSlot[] {
  const out: ISaludDisponibilidadSlot[] = []
  for (const fecha of fechas) {
    for (const b of blocks) out.push(slot(dia_semana, b.start, b.end, fecha))
  }
  return out
}

// Fechas representando ~4 weeks de lunes consecutivos
const MON_DATES = ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']

// --- Suite 1: deriveWeeklyPattern (15 tests) ---

console.log('\n=== Suite 1: deriveWeeklyPattern ===\n')

test('S1.1: single-block stable Mon 08-18 across 4 weeks', () => {
  const slots = weeklySlots(1, [{ start: '08:00', end: '18:00' }], MON_DATES)
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.monday.active, true, 'monday active')
  assertEq(r.derived.monday.blocks, [{ start: '08:00', end: '18:00' }], 'monday blocks')
  assertEq(r.derived.monday.confidence, 'high', 'monday confidence')
  assertEq(r.derived.monday.sourceDatesCount, 4, 'monday sourceDatesCount')
})

test('S1.2: split-shift Mon [08-12 + 14-18] stable across 4 weeks', () => {
  const slots = weeklySlots(
    1,
    [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    MON_DATES,
  )
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.monday.active, true, 'active')
  assertEq(
    r.derived.monday.blocks,
    [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    'split blocks',
  )
  assertEq(r.derived.monday.confidence, 'high', 'confidence')
})

test('S1.3: small gap (30min) merges to single block', () => {
  const slots = weeklySlots(
    1,
    [{ start: '08:00', end: '12:00' }, { start: '12:30', end: '18:00' }],
    MON_DATES,
  )
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.monday.blocks, [{ start: '08:00', end: '18:00' }], 'merged single block')
})

test('S1.4: large gap (90min) preserves split-shift', () => {
  const slots = weeklySlots(
    1,
    [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '18:00' }],
    MON_DATES,
  )
  const r = deriveWeeklyPattern(slots)
  assertEq(
    r.derived.monday.blocks,
    [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '18:00' }],
    'split with 90min gap',
  )
})

test('S1.5: empty Sunday → inactive + confidence none', () => {
  const slots = weeklySlots(1, [{ start: '08:00', end: '18:00' }], MON_DATES)
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.sunday.active, false, 'sunday inactive')
  assertEq(r.derived.sunday.blocks, [], 'sunday no blocks')
  assertEq(r.derived.sunday.confidence, 'none', 'sunday confidence none')
  assertEq(r.derived.sunday.sourceDatesCount, 0, 'sunday zero dates')
})

test('S1.6: single date for Mon → low confidence', () => {
  const slots = weeklySlots(1, [{ start: '08:00', end: '18:00' }], ['2026-06-08'])
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.monday.confidence, 'low', 'low confidence')
  assertEq(r.derived.monday.sourceDatesCount, 1, '1 date')
  // El patrón se deriva pero el script consumidor decide no aplicarlo
  assertEq(r.derived.monday.active, true, 'active')
  assertEq(r.derived.monday.blocks, [{ start: '08:00', end: '18:00' }], 'blocks present')
})

test('S1.7: inconsistent across 4 weeks (no mode) → most recent wins', () => {
  // Cada fecha tiene un patrón distinto (single block, distintos horarios)
  const slots = [
    ...weeklySlots(1, [{ start: '08:00', end: '12:00' }], ['2026-06-08']),
    ...weeklySlots(1, [{ start: '09:00', end: '13:00' }], ['2026-06-15']),
    ...weeklySlots(1, [{ start: '07:00', end: '11:00' }], ['2026-06-22']),
    ...weeklySlots(1, [{ start: '10:00', end: '14:00' }], ['2026-06-29']),
  ]
  const r = deriveWeeklyPattern(slots)
  // Most recent date is 2026-06-29 → 10:00-14:00 wins
  assertEq(r.derived.monday.blocks, [{ start: '10:00', end: '14:00' }], 'most recent pattern')
  assertEq(r.derived.monday.confidence, 'high', 'still high (>= 2 dates)')
})

test('S1.8: mode 2/4 vs 1+1 → mode wins', () => {
  const slots = [
    ...weeklySlots(1, [{ start: '08:00', end: '18:00' }], ['2026-06-08']),
    ...weeklySlots(1, [{ start: '08:00', end: '18:00' }], ['2026-06-15']),
    ...weeklySlots(1, [{ start: '09:00', end: '17:00' }], ['2026-06-22']),
    ...weeklySlots(1, [{ start: '10:00', end: '16:00' }], ['2026-06-29']),
  ]
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.monday.blocks, [{ start: '08:00', end: '18:00' }], 'modal pattern (2/4)')
})

test('S1.9: complete typical week (L-V + S, Sun off)', () => {
  const datesByDow: Record<number, string[]> = {
    1: ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'],
    2: ['2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30'],
    3: ['2026-06-10', '2026-06-17', '2026-06-24', '2026-07-01'],
    4: ['2026-06-11', '2026-06-18', '2026-06-25', '2026-07-02'],
    5: ['2026-06-12', '2026-06-19', '2026-06-26', '2026-07-03'],
    6: ['2026-06-13', '2026-06-20', '2026-06-27', '2026-07-04'],
  }
  const slots: ISaludDisponibilidadSlot[] = []
  for (const dow of [1, 2, 3, 4, 5]) {
    slots.push(...weeklySlots(dow, [{ start: '08:00', end: '18:00' }], datesByDow[dow]))
  }
  slots.push(...weeklySlots(6, [{ start: '08:00', end: '13:00' }], datesByDow[6]))

  const r = deriveWeeklyPattern(slots)
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as WeekdayKey[]) {
    assertEq(r.derived[day].active, true, `${day} active`)
    assertEq(r.derived[day].blocks, [{ start: '08:00', end: '18:00' }], `${day} blocks`)
    assertEq(r.derived[day].confidence, 'high', `${day} high`)
  }
  assertEq(r.derived.saturday.blocks, [{ start: '08:00', end: '13:00' }], 'sat blocks')
  assertEq(r.derived.sunday.confidence, 'none', 'sun none')
})

test('S1.10: doctor only weekends (Sat + Sun)', () => {
  const slots: ISaludDisponibilidadSlot[] = [
    ...weeklySlots(6, [{ start: '08:00', end: '13:00' }], ['2026-06-13', '2026-06-20']),
    ...weeklySlots(0, [{ start: '09:00', end: '12:00' }], ['2026-06-14', '2026-06-21']),
  ]
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.saturday.active, true, 'sat active')
  assertEq(r.derived.sunday.active, true, 'sun active')
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as WeekdayKey[]) {
    assertEq(r.derived[day].confidence, 'none', `${day} none`)
    assertEq(r.derived[day].active, false, `${day} inactive`)
  }
})

test('S1.11: invalid slot (hora_fin <= hora_inicio) is discarded', () => {
  const slots = [
    slot(1, '18:00', '08:00', '2026-06-08'), // inválido
    slot(1, '08:00', '18:00', '2026-06-08'),
    slot(1, '08:00', '18:00', '2026-06-15'),
  ]
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.monday.blocks, [{ start: '08:00', end: '18:00' }], 'invalid filtered')
  assertEq(r.derived.monday.sourceDatesCount, 2, 'still 2 dates valid')
})

test('S1.12: custom minDatesPerWeekday=3 → 2 dates is low', () => {
  const slots = weeklySlots(1, [{ start: '08:00', end: '18:00' }], MON_DATES.slice(0, 2))
  const r = deriveWeeklyPattern(slots, { minDatesPerWeekday: 3 })
  assertEq(r.derived.monday.confidence, 'low', 'low under stricter threshold')
})

test('S1.13: custom lunchGapMinutes=30 → 30min gap stays split', () => {
  const slots = weeklySlots(
    1,
    [{ start: '08:00', end: '12:00' }, { start: '12:30', end: '18:00' }],
    MON_DATES,
  )
  const r = deriveWeeklyPattern(slots, { lunchGapMinutes: 30 })
  // 30min gap == threshold; merge requires gap < threshold, so split
  assertEq(
    r.derived.monday.blocks,
    [{ start: '08:00', end: '12:00' }, { start: '12:30', end: '18:00' }],
    'split at threshold',
  )
})

test('S1.14: overlapping slots on same date merge', () => {
  const slots = [
    ...weeklySlots(1, [{ start: '08:00', end: '13:00' }, { start: '12:00', end: '17:00' }], MON_DATES),
  ]
  const r = deriveWeeklyPattern(slots)
  assertEq(r.derived.monday.blocks, [{ start: '08:00', end: '17:00' }], 'overlapping merged')
})

test('S1.15: slots in reverse order on input are sorted internally', () => {
  const slots = [
    ...weeklySlots(1, [{ start: '14:00', end: '18:00' }, { start: '08:00', end: '12:00' }], MON_DATES),
  ]
  const r = deriveWeeklyPattern(slots)
  assertEq(
    r.derived.monday.blocks,
    [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    'sorted output',
  )
})

// --- Suite 2: isDefaultWorkingHours (8 tests) ---

console.log('\n=== Suite 2: isDefaultWorkingHours ===\n')

// La función buildDefaultWorkingHours en sync-agent.ts retorna:
const SYNC_DEFAULT_WH = {
  sunday: { active: false, blocks: [] },
  monday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  tuesday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  wednesday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  thursday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  friday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  saturday: { active: true, blocks: [{ start: '08:00', end: '13:00' }] },
}

test('S2.1: exact output of buildDefaultWorkingHours → true', () => {
  assert(isDefaultWorkingHours(SYNC_DEFAULT_WH) === true, 'should be default')
})

test('S2.2: sunday variant with blocks=[{00:00, 00:00}] → true', () => {
  const variant = {
    ...SYNC_DEFAULT_WH,
    sunday: { active: false, blocks: [{ start: '00:00', end: '00:00' }] },
  }
  assert(isDefaultWorkingHours(variant) === true, 'sunday variant accepted')
})

test('S2.3: monday edited (09:00-18:00) → false', () => {
  const edited = {
    ...SYNC_DEFAULT_WH,
    monday: { active: true, blocks: [{ start: '09:00', end: '18:00' }] },
  }
  assert(isDefaultWorkingHours(edited) === false, 'monday tweak detected')
})

test('S2.4: wednesday split-shift → false', () => {
  const edited = {
    ...SYNC_DEFAULT_WH,
    wednesday: {
      active: true,
      blocks: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    },
  }
  assert(isDefaultWorkingHours(edited) === false, 'split detected')
})

test('S2.5: friday inactive → false', () => {
  const edited = { ...SYNC_DEFAULT_WH, friday: { active: false, blocks: [] } }
  assert(isDefaultWorkingHours(edited) === false, 'friday off detected')
})

test('S2.6: saturday with different hours → false', () => {
  const edited = {
    ...SYNC_DEFAULT_WH,
    saturday: { active: true, blocks: [{ start: '09:00', end: '13:00' }] },
  }
  assert(isDefaultWorkingHours(edited) === false, 'sat tweak detected')
})

test('S2.7: sunday active → false', () => {
  const edited = {
    ...SYNC_DEFAULT_WH,
    sunday: { active: true, blocks: [{ start: '08:00', end: '12:00' }] },
  }
  assert(isDefaultWorkingHours(edited) === false, 'sun active detected')
})

test('S2.8: missing days (incomplete object) → false', () => {
  const incomplete = {
    monday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  }
  assert(isDefaultWorkingHours(incomplete) === false, 'incomplete not default')
})

// --- Suite 3: Casos reales sintéticos de Algia (3 tests) ---

console.log('\n=== Suite 3: Algia synthetic cases ===\n')

test('S3.1: José Duván (default L-V 08-18 + S 08-13) → IS default', () => {
  const jose = {
    friday: { active: true, blocks: [{ end: '18:00', start: '08:00' }] },
    monday: { active: true, blocks: [{ end: '18:00', start: '08:00' }] },
    sunday: { active: false, blocks: [{ end: '00:00', start: '00:00' }] },
    tuesday: { active: true, blocks: [{ end: '18:00', start: '08:00' }] },
    saturday: { active: true, blocks: [{ end: '13:00', start: '08:00' }] },
    thursday: { active: true, blocks: [{ end: '18:00', start: '08:00' }] },
    wednesday: { active: true, blocks: [{ end: '18:00', start: '08:00' }] },
  }
  assert(isDefaultWorkingHours(jose) === true, 'Jose Duván should be detected as default')
})

test('S3.2: LINA (split-shift L-V con almuerzo) → IS NOT default', () => {
  const lina = {
    friday: { active: true, blocks: [{ end: '11:45', start: '07:15' }, { end: '16:15', start: '13:15' }] },
    monday: { active: true, blocks: [{ end: '11:45', start: '07:15' }, { end: '16:15', start: '13:15' }] },
    sunday: { active: false, blocks: [{ end: '00:00', start: '00:00' }] },
    tuesday: { active: true, blocks: [{ end: '11:45', start: '07:15' }, { end: '16:15', start: '13:15' }] },
    saturday: { active: false, blocks: [{ end: '13:00', start: '08:00' }] },
    thursday: { active: true, blocks: [{ end: '11:45', start: '07:15' }, { end: '16:15', start: '13:15' }] },
    wednesday: { active: true, blocks: [{ end: '11:45', start: '07:15' }, { end: '16:15', start: '13:15' }] },
  }
  assert(isDefaultWorkingHours(lina) === false, 'LINA edited, should be skipped')
})

test('S3.3: DANIELA (split-shift L-J + friday inactive + sat inactive) → IS NOT default', () => {
  const daniela = {
    friday: { active: false, blocks: [{ end: '18:00', start: '08:00' }] },
    monday: { active: true, blocks: [{ end: '11:30', start: '08:30' }, { end: '16:15', start: '13:15' }] },
    sunday: { active: false, blocks: [{ end: '00:00', start: '00:00' }] },
    tuesday: { active: true, blocks: [{ end: '11:30', start: '08:30' }, { end: '16:15', start: '13:15' }] },
    saturday: { active: false, blocks: [{ end: '13:00', start: '08:00' }] },
    thursday: { active: true, blocks: [{ end: '11:30', start: '08:30' }, { end: '16:15', start: '13:15' }] },
    wednesday: { active: true, blocks: [{ end: '11:30', start: '08:30' }, { end: '16:15', start: '13:15' }] },
  }
  assert(isDefaultWorkingHours(daniela) === false, 'DANIELA edited, should be skipped')
})

// --- Sanity check para helpers internos (no parte del 26, pero útil) ---

console.log('\n=== Sanity: helpers ===\n')

test('helper: hashBlocks empty → INACTIVE', () => {
  assertEq(hashBlocks([]), 'INACTIVE', 'empty hash')
})

test('helper: hashBlocks single block', () => {
  assertEq(hashBlocks([{ start: '08:00', end: '18:00' }]), '08:00-18:00', 'single hash')
})

test('helper: hashBlocks split sorted', () => {
  assertEq(
    hashBlocks([{ start: '14:00', end: '18:00' }, { start: '08:00', end: '12:00' }]),
    '08:00-12:00|14:00-18:00',
    'split sorted',
  )
})

// --- Reporte final ---

console.log('\n=== Resultado ===')
if (failed > 0) {
  console.log(`\n❌ Failures:\n`)
  failures.forEach((f) => console.log(f))
}
const total = passed + failed
console.log(`\n${passed} pasaron · ${failed} fallaron (total ${total})`)
process.exit(failed > 0 ? 1 : 0)
