// ============================================================
// Tests de src/lib/utils/format-time-ui.ts
//
// LO QUE PROTEGEN: que el formateo de la UI dé EL MISMO string en el servidor
// (Vercel corre en UTC) y en el navegador (America/Bogota). Si divergen, el
// HTML del servidor no coincide con el del cliente → mismatch de hidratación
// (React #418) → React descarta ese subárbol y los useEffect de adentro no
// corren. Ahí es donde se murió la suscripción de Realtime.
//
// CÓMO CORRERLO — la gracia es correrlo DOS VECES con zonas distintas:
//   TZ=UTC            npx tsx scripts/test-format-time-ui.ts
//   TZ=America/Bogota npx tsx scripts/test-format-time-ui.ts
// Los dos tienen que imprimir exactamente los mismos valores.
// ============================================================

import { format } from 'date-fns'
import {
  formatUI,
  formatTimeUI,
  dayKeyUI,
  isDifferentDayUI,
  formatDaySeparatorUI,
} from '../src/lib/utils/format-time-ui'

let pass = 0
let fail = 0

function eq(label: string, actual: string | boolean, expected: string | boolean) {
  if (actual === expected) {
    pass++
  } else {
    fail++
    console.error(`  ❌ ${label}\n     esperado: ${JSON.stringify(expected)}\n     obtenido: ${JSON.stringify(actual)}`)
  }
}

console.log(`TZ del proceso = ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)

// 9:30 PM del 4 de agosto en Bogotá == 02:30 UTC del 5 de agosto.
// Es el caso que rompía: cambia la hora Y el día calendario.
const nocheDel4 = '2026-08-05T02:30:00.000Z'
eq('hora de la noche', formatTimeUI(nocheDel4), '9:30 PM')
eq('día calendario', dayKeyUI(nocheDel4), '2026-08-04')
eq('separador de día', formatUI(nocheDel4, 'EEE d MMM').toUpperCase(), 'MAR 4 AGO')

// Mediodía: no hay ambigüedad de día, sirve de control.
const mediodia = '2026-08-05T17:00:00.000Z' // 12:00 PM en Bogotá
eq('hora del mediodía', formatTimeUI(mediodia), '12:00 PM')
eq('día del mediodía', dayKeyUI(mediodia), '2026-08-05')

// Medianoche exacta de Bogotá (05:00 UTC) — borde del corte de día.
const medianoche = '2026-08-05T05:00:00.000Z'
eq('medianoche COT', formatTimeUI(medianoche), '12:00 AM')
eq('día en medianoche', dayKeyUI(medianoche), '2026-08-05')

// Un minuto ANTES de esa medianoche sigue siendo el día anterior.
eq('un minuto antes', dayKeyUI('2026-08-05T04:59:00.000Z'), '2026-08-04')

// Separador de mensajes: dos timestamps de la misma noche de Bogotá que caen
// en días UTC distintos NO deben generar un separador de día.
eq(
  'mismo día en Bogotá aunque cambie el día UTC',
  isDifferentDayUI('2026-08-05T02:30:00.000Z', '2026-08-05T00:30:00.000Z'),
  false,
)
// Y dos que sí cambian de día en Bogotá, sí lo generan.
eq(
  'días distintos en Bogotá',
  isDifferentDayUI('2026-08-05T17:00:00.000Z', '2026-08-05T02:30:00.000Z'),
  true,
)

// HOY / AYER calculados contra un "ahora" explícito (determinista).
const ahora = '2026-08-05T17:00:00.000Z' // mediodía del 5 en Bogotá
eq('HOY', formatDaySeparatorUI('2026-08-05T14:00:00.000Z', ahora), 'HOY')
eq('AYER', formatDaySeparatorUI('2026-08-05T02:30:00.000Z', ahora), 'AYER')
eq('más viejo', formatDaySeparatorUI('2026-08-01T15:00:00.000Z', ahora), 'SÁB 1 AGO')

// Timestamp inválido → string vacío, nunca "Invalid Date" en pantalla.
eq('inválido', formatTimeUI('no-es-una-fecha'), '')

// ---- El control negativo: date-fns crudo SÍ depende de la zona ----
// Este bloque documenta el bug. En UTC imprime 2:30 AM y en Bogotá 9:30 PM;
// por eso NO se puede usar `format()` directo sobre un timestamp del servidor.
const crudo = format(new Date(nocheDel4), 'h:mm a')
const zonaProceso = Intl.DateTimeFormat().resolvedOptions().timeZone
console.log(`  (control) format() crudo en ${zonaProceso} → ${crudo}  ← este es el que divergía`)

console.log(`\n${pass} pasaron, ${fail} fallaron`)
process.exit(fail === 0 ? 0 : 1)
