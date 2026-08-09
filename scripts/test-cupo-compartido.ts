// ============================================================
// Tests de la distinción "cupo compartido" vs "bloqueo de agenda".
//
// Qué protegen: `blocked_external` NO significa una sola cosa. En Algia las 400
// filas con ese estado tienen paciente real — son citas que iSalud puso en un
// cupo ya ocupado y el sync degradó para no perderlas. Pero el estado TAMBIÉN
// se usa para bloqueos genuinos de agenda (sin paciente).
//
// Si las tres vistas del calendario deciden esto cada una por su cuenta, una va
// a decir "Cupo compartido" sobre un bloqueo vacío. Por eso hay una sola
// función y por eso existe este test.
//
// Correr: npx tsx scripts/test-cupo-compartido.ts
// ============================================================

import { esCupoCompartido, etiquetaEstado, BLOQUEO_SIN_PACIENTE }
  from '../src/components/dashboard/calendar/types'

let pass = 0, fail = 0
function t(label: string, got: unknown, want: unknown) {
  if (got === want) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label} — esperaba ${JSON.stringify(want)}, dio ${JSON.stringify(got)}`) }
}

console.log('\nEL CASO REAL: 400 filas con paciente')
t('paciente en cupo compartido', esCupoCompartido('blocked_external', 'JULIANA JIMENEZ SERNA'), true)
t('…y su etiqueta lo dice', etiquetaEstado('blocked_external', 'JULIANA JIMENEZ SERNA'), 'Cupo compartido')

console.log('\nEL BLOQUEO GENUINO (hoy no hay ninguno, pero el código los produce)')
t('sin paciente NO es cupo compartido', esCupoCompartido('blocked_external', BLOQUEO_SIN_PACIENTE), false)
t('…y se llama por su nombre', etiquetaEstado('blocked_external', BLOQUEO_SIN_PACIENTE), 'Bloqueo de agenda')
t('con espacios alrededor también', etiquetaEstado('blocked_external', '  Bloqueo iSalud  '), 'Bloqueo de agenda')

console.log('\nBORDES')
t('reason null → no se afirma que hay paciente',
  etiquetaEstado('blocked_external', null), 'Cupo compartido')
t('reason undefined idem', etiquetaEstado('blocked_external', undefined), 'Cupo compartido')
t('reason vacío idem', etiquetaEstado('blocked_external', ''), 'Cupo compartido')

console.log('\nLOS OTROS ESTADOS NO SE TOCAN')
t('confirmed', etiquetaEstado('confirmed', 'lo que sea'), 'Confirmada')
t('rescheduled', etiquetaEstado('rescheduled', null), 'Reagendada')
t('completed', etiquetaEstado('completed', null), 'Completada')
t('no_show', etiquetaEstado('no_show', null), 'No-show')
t('cancelled', etiquetaEstado('cancelled', null), 'Cancelada')
t('un estado desconocido se devuelve tal cual', etiquetaEstado('marciano', null), 'marciano')
t('confirmed nunca es cupo compartido', esCupoCompartido('confirmed', BLOQUEO_SIN_PACIENTE), false)

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
