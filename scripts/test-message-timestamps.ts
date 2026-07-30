/**
 * Fija formatTimestampColombia: el prefijo de timestamp del historial del agente.
 * - convierte UTC → hora Colombia (UTC-5, sin DST)
 * - formato ISO compacto "yyyy-MM-dd HH:mm"
 * - determinista: el mismo created_at rinde el mismo string siempre
 *
 * Run: TZ=UTC npx tsx scripts/test-message-timestamps.ts
 */
import { formatTimestampColombia } from '../src/lib/utils/dates'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('Tests — timestamp del historial (formatTimestampColombia)\n')

// El mensaje real de Lady: 2026-07-30 13:43 COT = 18:43 UTC
assert(
  'UTC 18:43 → COT 13:43 (mensaje de Lady)',
  formatTimestampColombia('2026-07-30T18:43:41Z') === '2026-07-30 13:43',
  formatTimestampColombia('2026-07-30T18:43:41Z'),
)
// Cruce de medianoche: 03:00 UTC = 22:00 COT del día ANTERIOR
assert(
  'UTC 03:00 → COT 22:00 del día previo (resta 5h cruza medianoche)',
  formatTimestampColombia('2026-06-05T03:00:00Z') === '2026-06-04 22:00',
  formatTimestampColombia('2026-06-05T03:00:00Z'),
)
// Determinismo: mismo input → mismo output (se renderiza igual en todos los turnos)
assert(
  'determinista: dos llamadas dan el mismo string',
  formatTimestampColombia('2026-06-04T12:55:00Z') === formatTimestampColombia('2026-06-04T12:55:00Z'),
)
// Fecha inválida → '' (no rompe el build del historial)
assert('fecha inválida → cadena vacía', formatTimestampColombia('no-es-fecha') === '')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
