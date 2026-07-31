/**
 * Tests — strip determinista del marcador [YYYY-MM-DD HH:MM] en la salida.
 * Run: npx tsx scripts/test-strip-timestamp-markers.ts
 */
import { stripTimestampMarkers } from '../src/lib/whatsapp/strip-timestamp-markers'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, got?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${got !== undefined ? ` — got: ${JSON.stringify(got)}` : ''}`); fail++ }
}

console.log('Tests — stripTimestampMarkers\n')

// 1. Corchete al INICIO (el eco real observado)
{
  const r = stripTimestampMarkers('[2026-07-31 08:30] ¡Hola Juan! 👋')
  assert('inicio: se remueve el marcador', r.text === '¡Hola Juan! 👋', r.text)
  assert('inicio: stripped=1', r.stripped === 1)
}

// 2. Corchete en el MEDIO
{
  const r = stripTimestampMarkers('Tu cita [2026-06-09 08:00] es el lunes')
  assert('medio: se remueve sin dejar espacio doble', r.text === 'Tu cita es el lunes', r.text)
  assert('medio: stripped=1', r.stripped === 1)
}

// 3. DOS marcadores en un mensaje
{
  const r = stripTimestampMarkers('[2026-07-31 08:30] Hola [2026-06-01 09:00] mundo')
  assert('dos: ambos removidos', r.text === 'Hola mundo', r.text)
  assert('dos: stripped=2', r.stripped === 2)
}

// 4. Mensaje NORMAL — no se toca
{
  const normal = '¡Hola! ¿En qué te puedo ayudar hoy? 😊'
  const r = stripTimestampMarkers(normal)
  assert('normal: intacto', r.text === normal, r.text)
  assert('normal: stripped=0', r.stripped === 0)
}

// 5. Corchete seguido de salto de línea
{
  const r = stripTimestampMarkers('[2026-07-31 08:30]\n¡Hola!')
  assert('salto: sin línea en blanco al inicio', r.text === '¡Hola!', r.text)
  assert('salto: stripped=1', r.stripped === 1)
}

// 6. Fecha en prosa (NO es el patrón) — no se toca
{
  const prosa = 'Tu cita es el martes 9 de junio de 2026 a las 8:00 AM'
  const r = stripTimestampMarkers(prosa)
  assert('prosa con fecha: intacta (no matchea el patrón ISO)', r.text === prosa && r.stripped === 0, r.text)
}

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
