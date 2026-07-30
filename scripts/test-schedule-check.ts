import { getDoctorDaySchedule, isStartWithinSchedule, dayKeyFromIndex } from '../src/lib/calendar/schedule-check'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('Tests — guard de horario (schedule-check)\n')

// working_hours reales (Juan Diego: L-V 08:00-18:00; Adriana: solo jueves 08:00-11:00)
const villegas = {
  monday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  tuesday: { active: true, blocks: [{ start: '08:00', end: '18:00' }] },
  sunday: { active: false, blocks: [] },
}
const adriana = {
  thursday: { active: true, blocks: [{ start: '08:00', end: '11:00' }] },
  monday: { active: false, blocks: [] },
  tuesday: { active: false, blocks: [] },
}
// LINA: split con hueco de almuerzo
const lina = {
  monday: { active: true, blocks: [{ start: '07:15', end: '11:45' }, { start: '13:15', end: '16:15' }] },
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

// --- DENTRO de horario ---
assert('DENTRO: Villegas lunes 12:00 (08–18)', isStartWithinSchedule('12:00', getDoctorDaySchedule(villegas, 'monday')))
assert('DENTRO: inicio exacto de franja 08:00 (08–18)', isStartWithinSchedule('08:00', getDoctorDaySchedule(villegas, 'monday')))

// --- FUERA de horario (mismo día activo, hora fuera) ---
assert('FUERA: 07:00 antes de 08:00', !isStartWithinSchedule('07:00', getDoctorDaySchedule(villegas, 'monday')))
assert('FUERA: Villegas 12:00 pero Adriana lunes inactivo NO aplica — control abajo', true)
assert('FUERA: LINA lunes 12:00 cae en el hueco 11:45–13:15', !isStartWithinSchedule('12:00', getDoctorDaySchedule(lina, 'monday')))

// --- DÍA INACTIVO ---
assert('DÍA INACTIVO: Adriana lunes 08:00 → fuera (no atiende)', !isStartWithinSchedule('08:00', getDoctorDaySchedule(adriana, 'monday')))
assert('DÍA INACTIVO: Adriana jueves 08:00 → dentro (sí atiende)', isStartWithinSchedule('08:00', getDoctorDaySchedule(adriana, 'thursday')))

// --- BORDE EXACTO DEL FINAL DE LA FRANJA (fin exclusivo) ---
assert('BORDE: 18:00 (fin de 08–18) → FUERA (empezar al cierre no vale)', !isStartWithinSchedule('18:00', getDoctorDaySchedule(villegas, 'monday')))
assert('BORDE: 11:00 (fin de 08–11 de Adriana jueves) → FUERA', !isStartWithinSchedule('11:00', getDoctorDaySchedule(adriana, 'thursday')))
assert('BORDE: 17:59 → DENTRO (justo antes del cierre)', isStartWithinSchedule('17:59', getDoctorDaySchedule(villegas, 'monday')))
// segunda franja de LINA: inicio exacto 13:15 dentro; 11:45 (fin de la primera) fuera
assert('BORDE: LINA 11:45 (fin franja 1) → FUERA', !isStartWithinSchedule('11:45', getDoctorDaySchedule(lina, 'monday')))
assert('BORDE: LINA 13:15 (inicio franja 2) → DENTRO', isStartWithinSchedule('13:15', getDoctorDaySchedule(lina, 'monday')))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
