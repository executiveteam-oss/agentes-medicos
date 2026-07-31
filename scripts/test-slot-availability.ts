/**
 * Suite PROPIA de disponibilidad de slots (no un test del fix): solapamiento,
 * bordes, hueco justo, día inactivo, y los tres estados de cita.
 * Run: npx tsx scripts/test-slot-availability.ts
 */
import { isSlotFree, slotOverlapsAny, isBusyStatus, BUSY_STATUSES, type BusyAppointment } from '../src/lib/calendar/slot-availability'
import { getDoctorDaySchedule, isRangeWithinSchedule } from '../src/lib/calendar/schedule-check'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void { if (ok) { console.log(`  ✅ ${label}`); pass++ } else { console.log(`  ❌ ${label}`); fail++ } }

// Helper: horas COT (UTC-5) → ISO instante. "08:30" del 2026-08-03.
const D = '2026-08-03'
function at(hhmm: string): string { return `${D}T${hhmm}:00-05:00` }
function appt(start: string, end: string, status = 'confirmed'): BusyAppointment { return { starts_at: at(start), ends_at: at(end), status } }

console.log('Suite — disponibilidad de slots\n')

// Caso real que rompió: cita iSalud 08:30-09:10; slots del grid 8:30/9:15/10:00.
const dia: BusyAppointment[] = [appt('08:30', '09:10'), appt('09:30', '10:10'), appt('10:10', '11:00'), appt('10:40', '11:30')]

// 1. slot que solapa por el FINAL de una cita previa
//    slot 08:45-09:25, cita previa 08:30-09:10 termina DESPUÉS de que arranca el slot
assert('solapa por el final de la cita previa → ocupado', !isSlotFree(at('08:45'), at('09:25'), dia))

// 2. slot que solapa por el PRINCIPIO de la siguiente
//    slot 09:15-09:55, cita siguiente 09:30-10:10 arranca ANTES del fin del slot
assert('solapa por el inicio de la siguiente → ocupado', !isSlotFree(at('09:15'), at('09:55'), dia))

// 3. slot que CONTIENE una cita entera
//    slot 08:00-09:30 contiene la cita 08:30-09:10
assert('contiene una cita entera → ocupado', !isSlotFree(at('08:00'), at('09:30'), [appt('08:30', '09:10')]))

// 4. slot que ALINEA exacto con una cita
assert('alinea exacto con la cita → ocupado', !isSlotFree(at('08:30'), at('09:10'), [appt('08:30', '09:10')]))

// 5. slot entre dos citas con HUECO justo (fin exclusivo → libre)
//    citas 08:00-08:30 y 09:15-10:00; slot 08:30-09:15 toca ambos bordes pero NO solapa
assert('hueco exacto entre dos citas (bordes tocan) → LIBRE',
  isSlotFree(at('08:30'), at('09:15'), [appt('08:00', '08:30'), appt('09:15', '10:00')]))

// 6. DÍA INACTIVO del médico (nivel día, no slot) — no hay franja donde ubicar el slot
const sabadoInactivo = { saturday: { active: false, blocks: [] }, thursday: { active: true, blocks: [{ start: '08:30', end: '11:30' }] } }
assert('día inactivo → getDoctorDaySchedule.active=false', getDoctorDaySchedule(sabadoInactivo, 'saturday').active === false)
assert('día inactivo → ninguna franja acepta el slot', !isRangeWithinSchedule('08:30', '09:10', getDoctorDaySchedule(sabadoInactivo, 'saturday')))

// 7. CADA UNO de los tres estados de cita ocupa; los no-ocupados NO
assert('confirmed ocupa', !isSlotFree(at('08:30'), at('09:00'), [appt('08:30', '09:10', 'confirmed')]))
assert('rescheduled ocupa', !isSlotFree(at('08:30'), at('09:00'), [appt('08:30', '09:10', 'rescheduled')]))
assert('blocked_external (iSalud) ocupa', !isSlotFree(at('08:30'), at('09:00'), [appt('08:30', '09:10', 'blocked_external')]))
assert('cancelled NO ocupa', isSlotFree(at('08:30'), at('09:00'), [appt('08:30', '09:10', 'cancelled')]))
assert('completed NO ocupa', isSlotFree(at('08:30'), at('09:00'), [appt('08:30', '09:10', 'completed')]))
assert('no_show NO ocupa', isSlotFree(at('08:30'), at('09:00'), [appt('08:30', '09:10', 'no_show')]))
assert('BUSY_STATUSES son exactamente los tres', BUSY_STATUSES.join(',') === 'confirmed,rescheduled,blocked_external')
assert('isBusyStatus(cancelled)=false', !isBusyStatus('cancelled'))

// 8. tolerancia de formato: +00:00 (Supabase) vs .000Z (toISOString) — mismo instante
assert('mismo instante en formatos distintos → solapa',
  slotOverlapsAny('2026-08-03T13:30:00.000Z', '2026-08-03T14:10:00.000Z', [{ starts_at: '2026-08-03T13:30:00+00:00', ends_at: '2026-08-03T14:10:00+00:00' }]))

// 9. fecha inválida → NO ofrecer (defensivo)
assert('fecha inválida → tratado como ocupado', !isSlotFree('no-es-fecha', at('09:00'), []))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
