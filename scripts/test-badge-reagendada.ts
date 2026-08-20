/**
 * El badge de una cita movida.
 *
 * La cita vieja de un reagendamiento ya no queda en 'rescheduled' —lo leían ~30
 * consultas como cita VIVA— sino en 'cancelled' con el motivo. Pero "la
 * movieron" y "no podía venir" no son lo mismo para quien mira la agenda, así
 * que el badge sale del MOTIVO.
 *
 * El enlace entre el executor (que escribe el motivo) y la pantalla (que lo
 * lee) es el prefijo MOTIVO_REAGENDADA. Este test es lo que avisa si alguien
 * cambia uno y no el otro.
 *
 * Run: npx tsx scripts/test-badge-reagendada.ts
 */
import { etiquetaEstado, estiloEstado, esCancelacionPorReagendamiento, MOTIVO_REAGENDADA } from '../src/components/dashboard/calendar/types'

let fallos = 0
function chequear(nombre: string, ok: boolean): void {
  console.log(`  ${ok ? '✅' : '🔴'} ${nombre}`)
  if (!ok) fallos++
}

// Exactamente lo que escribe rescheduleAppointment.
const motivoReal = 'Reagendada: movida del jueves 28 de agosto al sábado 30 de agosto'

console.log('\nCita movida (cancelled + motivo de reagendamiento)')
chequear('se reconoce como reagendamiento', esCancelacionPorReagendamiento('cancelled', motivoReal))
chequear('el badge dice "Reagendada"', etiquetaEstado('cancelled', null, null, motivoReal) === 'Reagendada')
chequear('el color es ámbar, no gris de cancelación',
  estiloEstado('cancelled', motivoReal).fg === estiloEstado('rescheduled', null).fg)

console.log('\nCancelación común')
chequear('no se confunde con reagendamiento', !esCancelacionPorReagendamiento('cancelled', 'La paciente no puede asistir'))
chequear('el badge dice "Cancelada"', etiquetaEstado('cancelled', null, null, 'La paciente no puede asistir') === 'Cancelada')
chequear('sin motivo también dice "Cancelada"', etiquetaEstado('cancelled', null, null, null) === 'Cancelada')

console.log('\nNo se rompe lo que ya andaba')
chequear('confirmed sigue "Agendada"', etiquetaEstado('confirmed', null, null, null) === 'Agendada')
chequear('un extra sigue "Extra"', etiquetaEstado('blocked_external', 'Ana', 'dashboard', null) === 'Extra')
chequear('un cupo compartido sigue igual', etiquetaEstado('blocked_external', 'Ana', 'isalud', null) === 'Cupo compartido')
chequear('filas históricas en rescheduled siguen legibles', etiquetaEstado('rescheduled', null, null, null) === 'Reagendada')

console.log('\nEl enlace executor ↔ pantalla')
chequear(`el motivo real empieza con "${MOTIVO_REAGENDADA}"`, motivoReal.startsWith(MOTIVO_REAGENDADA))

console.log(fallos === 0 ? '\n── 10/10 ──\n' : `\n── 🔴 ${fallos} fallo(s) ──\n`)
process.exit(fallos === 0 ? 0 : 1)
