/**
 * Tests PUROS del guard de horario: la cita cabe COMPLETA (inicio Y fin) en
 * una franja del médico, uniendo franjas contiguas. Sin DB, sin agente.
 *
 * Run: npx tsx scripts/test-schedule-check.ts
 */
import { getDoctorDaySchedule, isRangeWithinSchedule, dayKeyFromIndex } from '../src/lib/calendar/schedule-check'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('Tests — guard de horario (cabe completa en la franja)\n')

const villegas = {
  monday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  sunday: { active: false, blocks: [] },
}
const adriana = {
  thursday: { active: true, blocks: [{ start: '08:00', end: '11:00' }] },
  monday: { active: false, blocks: [] },
}
// LINA: split con hueco de almuerzo (NO contiguo)
const lina = {
  monday: { active: true, blocks: [{ start: '07:15', end: '11:45' }, { start: '13:15', end: '16:15' }] },
}
// Franjas CONTIGUAS (una termina donde arranca la otra)
const contiguo = {
  monday: { active: true, blocks: [{ start: '08:00', end: '12:00' }, { start: '12:00', end: '16:00' }] },
}

// dayKeyFromIndex
assert('dayKeyFromIndex(1)=monday', dayKeyFromIndex(1) === 'monday')
assert('dayKeyFromIndex(0)=sunday', dayKeyFromIndex(0) === 'sunday')
assert('dayKeyFromIndex(4)=thursday', dayKeyFromIndex(4) === 'thursday')

// getDoctorDaySchedule
assert('día activo con bloques', getDoctorDaySchedule(villegas, 'monday').active === true)
assert('día inactivo', getDoctorDaySchedule(adriana, 'monday').active === false)
assert('working_hours null → inactivo', getDoctorDaySchedule(null, 'monday').active === false)
assert('día ausente en el JSON → inactivo', getDoctorDaySchedule(villegas, 'saturday').active === false)

const monVillegas = getDoctorDaySchedule(villegas, 'monday')
const thuAdriana = getDoctorDaySchedule(adriana, 'thursday')
const monLina = getDoctorDaySchedule(lina, 'monday')
const monContiguo = getDoctorDaySchedule(contiguo, 'monday')

// --- DENTRO (cita entera dentro de la franja) ---
assert('DENTRO: 12:00–12:30 en 08–18', isRangeWithinSchedule('12:00', '12:30', monVillegas))
assert('DENTRO: inicio exacto 08:00–09:00', isRangeWithinSchedule('08:00', '09:00', monVillegas))
assert('BORDE fin inclusivo: 17:30–18:00 (fin = cierre) DENTRO', isRangeWithinSchedule('17:30', '18:00', monVillegas))

// --- FUERA porque el FIN se pasa de la franja (lo que start-only NO atrapaba) ---
assert('FUERA: 17:45–18:15 el fin se pasa de las 18:00', !isRangeWithinSchedule('17:45', '18:15', monVillegas))
assert('FUERA: 07:30–08:00 empieza antes de abrir', !isRangeWithinSchedule('07:30', '08:00', monVillegas))

// --- DÍA INACTIVO ---
assert('DÍA INACTIVO: Adriana lunes 08:00–08:30 → fuera', !isRangeWithinSchedule('08:00', '08:30', getDoctorDaySchedule(adriana, 'monday')))
assert('DÍA ACTIVO: Adriana jueves 08:00–09:00 → dentro', isRangeWithinSchedule('08:00', '09:00', thuAdriana))
assert('BORDE: Adriana jueves 10:30–11:00 (fin=cierre) dentro', isRangeWithinSchedule('10:30', '11:00', thuAdriana))
assert('FUERA: Adriana jueves 10:45–11:15 el fin se pasa', !isRangeWithinSchedule('10:45', '11:15', thuAdriana))

// --- SPLIT con hueco (NO contiguo): no se puede cruzar el almuerzo ---
assert('DENTRO franja 1 de LINA: 10:00–11:00', isRangeWithinSchedule('10:00', '11:00', monLina))
assert('DENTRO franja 2 de LINA: 13:30–14:00', isRangeWithinSchedule('13:30', '14:00', monLina))
assert('FUERA: LINA 11:30–13:30 cruza el hueco de almuerzo', !isRangeWithinSchedule('11:30', '13:30', monLina))
assert('FUERA: LINA 11:30–12:00 cae dentro del hueco', !isRangeWithinSchedule('11:30', '12:00', monLina))

// --- CONTIGUAS: se tratan como un solo bloque, la cita puede cruzar el borde ---
assert('CONTIGUO: 11:45–12:15 cruza el borde 12:00 → DENTRO (bloques pegados)', isRangeWithinSchedule('11:45', '12:15', monContiguo))
assert('CONTIGUO: 08:00–16:00 abarca ambos bloques unidos → DENTRO', isRangeWithinSchedule('08:00', '16:00', monContiguo))
assert('CONTIGUO: 15:30–16:00 (fin=cierre del segundo) DENTRO', isRangeWithinSchedule('15:30', '16:00', monContiguo))
assert('CONTIGUO: 15:45–16:15 el fin se pasa del bloque unido → FUERA', !isRangeWithinSchedule('15:45', '16:15', monContiguo))

// --- Rango degenerado ---
assert('fin <= inicio → false', !isRangeWithinSchedule('10:00', '10:00', monVillegas))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
