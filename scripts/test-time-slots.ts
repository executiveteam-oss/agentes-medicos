// Tests — grilla de cupos SIEMPRE en :00/:15/:30/:45, sin importar la duración.
import { generateTimeSlots, ceilToGrid } from '../src/lib/calendar/time-slots'

let ok = 0, fail = 0
function assert(name: string, cond: boolean) { if (cond) { ok++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }

// Minutos COT de un cupo (offset -05:00, hora entera → minutos UTC == minutos COT)
function mins(utc: string): number { return new Date(utc).getUTCMinutes() }
function allOnGrid(slots: { utc: string }[]): boolean { return slots.every((s) => mins(s.utc) % 15 === 0) }

const D = '2026-08-06'

console.log('Duración 19 (la que causaba 3:17/3:55) → grilla limpia\n')
const s19 = generateTimeSlots(D, '08:00', '18:00', 19)
assert('todos los cupos caen en :00/:15/:30/:45', allOnGrid(s19))
assert('primer cupo 08:00', s19[0].utc === '2026-08-06T13:00:00.000Z')
assert('segundo cupo 08:15 (grilla de 15, no de 19)', s19[1].utc === '2026-08-06T13:15:00.000Z')
assert('ningún cupo en minuto :17 ni :55', !s19.some((s) => [17, 55, 36, 14, 33].includes(mins(s.utc))))

console.log('\nOtras duraciones que no dividen la hora (45, 50) → también limpias\n')
assert('45 min: todos en grilla', allOnGrid(generateTimeSlots(D, '08:00', '18:00', 45)))
assert('50 min: todos en grilla', allOnGrid(generateTimeSlots(D, '08:00', '18:00', 50)))

console.log('\nDuraciones limpias siguen bien\n')
const s30 = generateTimeSlots(D, '08:00', '10:00', 30)
assert('30 min 8-10: 8:00,8:15,8:30,... hasta que quepa (último 9:30)', s30[s30.length - 1].utc === '2026-08-06T14:30:00.000Z')
assert('30 min: todos en grilla', allOnGrid(s30))

console.log('\nBloque que arranca fuera de grilla (08:10) se alinea a 08:15\n')
const s10 = generateTimeSlots(D, '08:10', '10:00', 20)
assert('primer cupo 08:15 (no 08:10)', s10[0].utc === '2026-08-06T13:15:00.000Z')

console.log('\nEl cupo cabe completo antes del cierre\n')
const tight = generateTimeSlots(D, '08:00', '08:40', 30)
assert('8:00-8:40 con 30min → solo 8:00 (8:15 no cabe: 8:45>8:40)', tight.length === 1 && tight[0].utc === '2026-08-06T13:00:00.000Z')

console.log('\nceilToGrid redondea hacia arriba\n')
assert('08:07 → 08:15', ceilToGrid(new Date('2026-08-06T13:07:00Z')).toISOString() === '2026-08-06T13:15:00.000Z')
assert('08:15 exacto → 08:15', ceilToGrid(new Date('2026-08-06T13:15:00Z')).toISOString() === '2026-08-06T13:15:00.000Z')

console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
if (fail > 0) process.exit(1)
