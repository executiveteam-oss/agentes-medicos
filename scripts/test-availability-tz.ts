/**
 * Tests del fix de timezone en check_availability (executor.ts:162).
 *
 * Bug reportado por Lady (Algia) 2026-06-04:
 *   parseISO('YYYY-MM-DD') sin sufijo produce midnight UTC.
 *   En Vercel (TZ=UTC) al pasar por toZonedTime+getDay() para Bogotá,
 *   devuelve el día ANTERIOR. Resultado: dayKey lookup busca config
 *   del día equivocado.
 *
 * Run:
 *   TZ=UTC                npx tsx scripts/test-availability-tz.ts
 *   TZ=America/Bogota     npx tsx scripts/test-availability-tz.ts
 *
 * AMBAS deben pasar — el bug original solo aparece en UTC, pero la
 * función debe ser TZ-independent.
 */

import { parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TIMEZONE = 'America/Bogota'

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

// ============================================================
// REPLICAS EXACTAS del código de producción
// ============================================================

// Versión BUGGY (la que estaba en main antes del fix)
function dateBuggy(dateStr: string): Date {
  return parseISO(dateStr)
}

// Versión FIJA (la nueva en main)
function dateFixed(dateStr: string): Date {
  return parseISO(`${dateStr}T12:00:00-05:00`)
}

// Replica de getDayOfWeek (src/lib/utils/dates.ts:141)
function getDayOfWeek(date: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const zoned = toZonedTime(date, TIMEZONE)
  return days[zoned.getDay()]
}

// Replica de spanishDayOfWeek (src/agents/tools/executor.ts:27)
const SPANISH_DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
function spanishDayOfWeek(dateStr: string): string {
  return SPANISH_DAY_NAMES[toZonedTime(parseISO(`${dateStr}T12:00:00-05:00`), TIMEZONE).getDay()]
}

// ============================================================
// FIXTURE — Jorge Darío's working_hours en producción
// ============================================================
const JORGE_HOURS: Record<string, { active: boolean; blocks: { start: string; end: string }[] }> = {
  monday:    { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
  tuesday:   { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
  wednesday: { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
  thursday:  { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
  friday:    { active: true,  blocks: [{ start: '08:00', end: '18:00' }] },
  saturday:  { active: true,  blocks: [{ start: '08:00', end: '13:00' }] },
  sunday:    { active: false, blocks: [] },
}

// ============================================================
// CASOS de prueba — 7 días + caso exacto de Lady
// ============================================================
// Junio 2026: jun 8 = Lunes; jun 14 = Domingo
const SEMANA = [
  { dateStr: '2026-06-08', expectedKey: 'monday',    expectedES: 'lunes',     doctorOpen: true,  expectedHours: '08:00-18:00' },
  { dateStr: '2026-06-09', expectedKey: 'tuesday',   expectedES: 'martes',    doctorOpen: true,  expectedHours: '08:00-18:00' },
  { dateStr: '2026-06-10', expectedKey: 'wednesday', expectedES: 'miércoles', doctorOpen: true,  expectedHours: '08:00-18:00' },
  { dateStr: '2026-06-11', expectedKey: 'thursday',  expectedES: 'jueves',    doctorOpen: true,  expectedHours: '08:00-18:00' },
  { dateStr: '2026-06-12', expectedKey: 'friday',    expectedES: 'viernes',   doctorOpen: true,  expectedHours: '08:00-18:00' },
  { dateStr: '2026-06-13', expectedKey: 'saturday',  expectedES: 'sábado',    doctorOpen: true,  expectedHours: '08:00-13:00' },
  { dateStr: '2026-06-14', expectedKey: 'sunday',    expectedES: 'domingo',   doctorOpen: false, expectedHours: ''           },
] as const

// ============================================================
// EJECUCIÓN
// ============================================================
const runtimeTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone

console.log('🧪 Tests fix TZ en check_availability')
console.log(`Server TZ: ${runtimeTz}`)
console.log('='.repeat(50))

console.log('\n--- Sección 1: dateFixed resuelve el dayKey correcto ---')
for (const c of SEMANA) {
  const dayKey = getDayOfWeek(dateFixed(c.dateStr))
  assert(`${c.dateStr} (${c.expectedES}) → dayKey="${c.expectedKey}"`, dayKey === c.expectedKey, `got "${dayKey}"`)
}

console.log('\n--- Sección 2: spanishDayOfWeek (mensaje al usuario) también correcto ---')
for (const c of SEMANA) {
  const dow = spanishDayOfWeek(c.dateStr)
  assert(`${c.dateStr} → "${c.expectedES}"`, dow === c.expectedES, `got "${dow}"`)
}

console.log('\n--- Sección 3: Doctor Jorge — apertura correcta por día ---')
for (const c of SEMANA) {
  const dayKey = getDayOfWeek(dateFixed(c.dateStr)) as keyof typeof JORGE_HOURS
  const cfg = JORGE_HOURS[dayKey]
  const isOpen = cfg.active && cfg.blocks.length > 0
  assert(`${c.expectedES}: doctor abre=${c.doctorOpen}`, isOpen === c.doctorOpen)
  if (c.doctorOpen) {
    const hours = `${cfg.blocks[0].start}-${cfg.blocks[0].end}`
    assert(`  ${c.expectedES}: horario=${c.expectedHours}`, hours === c.expectedHours, `got "${hours}"`)
  }
}

console.log('\n--- Sección 4: REPRODUCCIÓN del bug — versión buggy fallaría en TZ=UTC ---')
// Solo aplica si TZ=UTC; en TZ=Bogota la versión buggy "casualmente" funciona.
if (runtimeTz === 'UTC') {
  // Lunes Jun 8 con versión buggy debería resolver a 'sunday' (= bug)
  const buggyKey = getDayOfWeek(dateBuggy('2026-06-08'))
  assert('TZ=UTC: dateBuggy("2026-06-08") devuelve "sunday" (= bug del agente)', buggyKey === 'sunday', `got "${buggyKey}"`)

  // Sábado Jun 13 con versión buggy resuelve a 'friday'
  const buggySat = getDayOfWeek(dateBuggy('2026-06-13'))
  assert('TZ=UTC: dateBuggy("2026-06-13") devuelve "friday" (= bug del agente)', buggySat === 'friday', `got "${buggySat}"`)

  // Domingo Jun 14 con versión buggy resuelve a 'saturday'
  const buggySun = getDayOfWeek(dateBuggy('2026-06-14'))
  assert('TZ=UTC: dateBuggy("2026-06-14") devuelve "saturday" (= bug del agente)', buggySun === 'saturday', `got "${buggySun}"`)
} else {
  console.log(`  (saltada — solo TZ=UTC reproduce el shift; runtime actual ${runtimeTz} no lo expone)`)
}

console.log('\n--- Sección 5: CASO LADY — "lunes" 4 jun 2026 → jorge atiende ---')
{
  // Lady escribió "lunes" cuando hoy era jueves 4 jun 2026.
  // calculate_date('lunes', 'this') retornaba '2026-06-08' (próximo lunes).
  const dateStr = '2026-06-08'

  // Pre-fix: agente decía "no atiende lunes" porque dayKey=sunday
  const buggyKey = getDayOfWeek(dateBuggy(dateStr))
  const buggyOpen = JORGE_HOURS[buggyKey as keyof typeof JORGE_HOURS].active
  // Post-fix: dayKey=monday, monday.active=true
  const fixedKey = getDayOfWeek(dateFixed(dateStr))
  const fixedOpen = JORGE_HOURS[fixedKey as keyof typeof JORGE_HOURS].active

  if (runtimeTz === 'UTC') {
    assert('Caso Lady (TZ=UTC): versión buggy decía cerrado', buggyOpen === false)
  }
  assert('Caso Lady: versión fija dice ABIERTO (8:00-18:00)', fixedOpen === true)
  assert('Caso Lady: dayKey resuelto = "monday"', fixedKey === 'monday')
}

console.log('\n--- Sección 6: COINCIDENCIA cósmica martes 9 jun ---')
{
  // Por qué la cita de Lady el martes 9 sí se creó pese al bug:
  // dateBuggy('2026-06-09') → resuelve a 'monday' (también activo 8-18)
  // → check_availability ofreció slots; create_appointment grabó '2026-06-09T08:00:00-05:00' correcto
  if (runtimeTz === 'UTC') {
    const buggyKey = getDayOfWeek(dateBuggy('2026-06-09'))
    assert('TZ=UTC: dateBuggy("2026-06-09") devuelve "monday" (¡coincidencia!)', buggyKey === 'monday')
    assert('  monday tiene mismo horario que tuesday → bug invisible este día', JORGE_HOURS.monday.blocks[0].end === JORGE_HOURS.tuesday.blocks[0].end)
  }
  // Post-fix, dayKey martes correcto
  const fixedKey = getDayOfWeek(dateFixed('2026-06-09'))
  assert('Post-fix: martes 9 jun → dayKey "tuesday"', fixedKey === 'tuesday')
}

console.log(`\n${passed} pasaron · ${failed} fallaron`)
if (failed > 0) process.exit(1)
