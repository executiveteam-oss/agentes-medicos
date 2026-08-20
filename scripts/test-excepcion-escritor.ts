/**
 * ¿El escritor honra una excepción de fecha? Prueba PURA, sin DB.
 *
 * Los dos días con excepción que hay cargados caen dentro del mínimo de
 * anticipación, así que contra producción no se puede contrastar (cero cupos
 * ofrecidos = nada que verificar). Acá se ejercita la decisión con las
 * funciones REALES y datos sintéticos: un médico con el jueves INACTIVO y una
 * excepción de 07:00–11:00 para ese jueves puntual.
 *
 * Antes: el escritor miraba working_hours (jueves inactivo) → rechazaba.
 * Ahora: mira las franjas que devuelve resolverDisponibilidadDia → acepta.
 *
 * Run: npx tsx scripts/test-excepcion-escritor.ts
 */
import { resolverDisponibilidadDia } from '../src/lib/calendar/day-availability'
import { isRangeWithinSchedule } from '../src/lib/calendar/schedule-check'

const jueves = {
  fecha: '2026-09-24', diaSemana: 'jueves', indiceDiaSemana: 4,
  medico: {
    nombre: 'MÉDICO DE PRUEBA',
    working_hours: { thursday: { active: false, blocks: [] }, friday: { active: true, blocks: [{ start: '07:30', end: '11:00' }] } },
    agenda_closed: false, agenda_closed_reason: null, agenda_closed_until: null,
    schedule_type: null, manual_availability_message: null,
  },
  fechaBloqueada: null, festivo: null, estadoClinica: null,
  configWhatsApp: null, horarioClinica: null,
}

let fallos = 0
function chequear(nombre: string, ok: boolean): void {
  console.log(`  ${ok ? '✅' : '🔴'} ${nombre}`)
  if (!ok) fallos++
}

console.log('\nJueves 24/09 — semanal INACTIVO')
const sinExc = resolverDisponibilidadDia({ ...jueves, excepcion: null })
chequear('sin excepción, el día no se atiende', sinExc.atiende === false)
chequear('sin excepción, 09:00 NO es escribible',
  !isRangeWithinSchedule('09:00', '09:30', { active: sinExc.atiende, blocks: sinExc.franjas }))

console.log('\nMismo jueves — con excepción 07:00–11:00')
const conExc = resolverDisponibilidadDia({ ...jueves, excepcion: { blocks: [{ start: '07:00', end: '11:00' }], reason: null } })
chequear('con excepción, el día SÍ se atiende', conExc.atiende === true)
chequear('las franjas son las de la excepción', JSON.stringify(conExc.franjas) === JSON.stringify([{ start: '07:00', end: '11:00' }]))
chequear('09:00 SÍ es escribible (era el bug)',
  isRangeWithinSchedule('09:00', '09:30', { active: conExc.atiende, blocks: conExc.franjas }))
chequear('12:00 sigue sin ser escribible (fuera de la excepción)',
  !isRangeWithinSchedule('12:00', '12:30', { active: conExc.atiende, blocks: conExc.franjas }))

console.log('\nUna excepción NO abre un día BLOQUEADO')
const bloqueado = resolverDisponibilidadDia({
  ...jueves, fechaBloqueada: { doctor_id: null, reason: 'FESTIVO' },
  excepcion: { blocks: [{ start: '07:00', end: '11:00' }], reason: null },
})
chequear('con fecha bloqueada, la excepción no la destapa', bloqueado.atiende === false && bloqueado.bloqueo !== null)

console.log(fallos === 0 ? '\n── 6/6 ──\n' : `\n── 🔴 ${fallos} fallo(s) ──\n`)
process.exit(fallos === 0 ? 0 : 1)
