/**
 * Extras — parte pura, sin DB ni red.
 *
 * Lo que se verifica acá es que la etiqueta salga del ORIGEN y que la marca de
 * asistencia dependa de si hay PACIENTE, no del status. La garantía de que el
 * agente no ofrezca el cupo se verifica aparte, contra la base.
 *
 * Run: npx tsx scripts/test-extra-etiquetas.ts
 */
import { etiquetaEstado, esExtraDelPanel, esCupoCompartido, BLOQUEO_SIN_PACIENTE } from '../src/components/dashboard/calendar/types'
import { isBusyStatus, BUSY_STATUSES } from '../src/lib/calendar/slot-availability'

let passed = 0, failed = 0
function eq(label: string, actual: unknown, esperado: unknown) {
  const ok = actual === esperado
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label} — esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(actual)}`); failed++ }
}

console.log('\n═══ La etiqueta sale del ORIGEN, no del estado ═══')
eq('extra del panel → "Extra"', etiquetaEstado('blocked_external', 'Control', 'dashboard'), 'Extra')
eq('cupo compartido de iSalud → "Cupo compartido"', etiquetaEstado('blocked_external', 'COLPOSCOPIA', 'isalud'), 'Cupo compartido')
eq('bloqueo sin paciente → "Bloqueo de agenda"', etiquetaEstado('blocked_external', BLOQUEO_SIN_PACIENTE, 'isalud'), 'Bloqueo de agenda')
eq('cita normal no se toca', etiquetaEstado('confirmed', null, 'dashboard'), 'Agendada')
eq('sin source, se comporta como antes', etiquetaEstado('blocked_external', 'COLPOSCOPIA'), 'Cupo compartido')

console.log('\n═══ Quién es extra ═══')
eq('creado en el panel', esExtraDelPanel('blocked_external', 'dashboard'), true)
eq('traído por el sync NO es extra', esExtraDelPanel('blocked_external', 'isalud'), false)
eq('una cita normal del panel NO es extra', esExtraDelPanel('confirmed', 'dashboard'), false)

console.log('\n═══ 🔒 El agente sigue viendo el cupo OCUPADO ═══')
// Ésta es la garantía que sostiene toda la separación: un extra existe porque
// el médico lo autorizó, y eso el agente no lo puede saber. Si blocked_external
// saliera de BUSY_STATUSES, el agente empezaría a ofrecer cupos con extra.
eq('blocked_external ocupa cupo', isBusyStatus('blocked_external'), true)
eq('confirmed ocupa cupo', isBusyStatus('confirmed'), true)
eq('cancelled NO ocupa cupo', isBusyStatus('cancelled'), false)
eq('BUSY_STATUSES incluye blocked_external', BUSY_STATUSES.includes('blocked_external' as never), true)

console.log('\n═══ Marca de asistencia: por PACIENTE, no por estado ═══')
// Réplica de la condición del componente (quick-actions).
const puedeMarcar = (status: string, tienePaciente: boolean) => !(status === 'cancelled' || !tienePaciente)
eq('extra con paciente → SÍ se puede marcar', puedeMarcar('blocked_external', true), true)
eq('cupo compartido de iSalud con ficha → SÍ', puedeMarcar('blocked_external', true), true)
eq('bloqueo de agenda sin paciente → no', puedeMarcar('blocked_external', false), false)
eq('cancelada → no', puedeMarcar('cancelled', true), false)
void esCupoCompartido

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
