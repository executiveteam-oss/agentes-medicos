/**
 * Tests PUROS del chequeo de "fecha futura" que comparten los tres caminos del
 * executor (create / cancel / reschedule). `now` fijo → deterministas, sin TZ.
 *
 * Run: npx tsx scripts/test-date-guards.ts
 */
import { isFutureStart } from '../src/lib/calendar/schedule-check'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('Tests — fecha futura (isFutureStart), backstop de los 3 caminos\n')

// "Ahora" fijo: 2026-07-30 18:00:00 UTC (= 13:00 COT)
const now = new Date('2026-07-30T18:00:00Z')

// Fecha pasada dentro de una franja válida (el caso de Lady: 9 jun 08:00)
assert('fecha pasada (9 jun, dentro de franja) → NO futura', isFutureStart('2026-06-09T13:00:00Z', now) === false)

// Hoy pero más temprano que ahora
assert('hoy 17:00Z (antes que ahora 18:00Z) → NO futura', isFutureStart('2026-07-30T17:00:00Z', now) === false)

// Borde: hoy en unos minutos → SÍ debe pasar
assert('hoy en +5 min (18:05Z) → futura ✓', isFutureStart('2026-07-30T18:05:00Z', now) === true)

// Instante exacto de ahora → NO (estrictamente futuro)
assert('exactamente ahora (18:00Z) → NO futura', isFutureStart('2026-07-30T18:00:00Z', now) === false)

// Día futuro
assert('mañana → futura ✓', isFutureStart('2026-07-31T13:00:00Z', now) === true)

// Fecha inválida → false (defensivo)
assert('fecha inválida → NO futura', isFutureStart('no-es-fecha', now) === false)

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
