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
import { formatParaRegistro, formatForPatient } from '../src/lib/utils/dates'

let fallos = 0
function chequear(nombre: string, ok: boolean): void {
  console.log(`  ${ok ? '✅' : '🔴'} ${nombre}`)
  if (!ok) fallos++
}

// Exactamente lo que escribe rescheduleAppointment, con formatParaRegistro:
// lleva AÑO porque este texto queda en la fila y se lee mucho después.
const motivoReal = 'Reagendada: movida del 28/08/2026, 7:30 AM al 30/08/2026, 9:00 AM'

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
chequear('el motivo lleva el año en las dos fechas', (motivoReal.match(/\/20\d\d/g) ?? []).length === 2)

console.log('\nformatParaRegistro vs formatForPatient')
const iso = '2026-08-28T12:30:00.000Z'   // 7:30 AM COT
chequear('el de registro lleva año (DD/MM/YYYY)', formatParaRegistro(iso) === '28/08/2026, 7:30 a. m.' || /^28\/08\/2026, 7:30/.test(formatParaRegistro(iso)))
chequear('el de la paciente NO lleva año', !/20\d\d/.test(formatForPatient(iso)))

console.log(fallos === 0 ? '\n── 13/13 ──\n' : `\n── 🔴 ${fallos} fallo(s) ──\n`)
process.exit(fallos === 0 ? 0 : 1)
