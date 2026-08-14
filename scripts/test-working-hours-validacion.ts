// ============================================================
// Tests de la validación de horarios por bloques.
//
// EL CASO QUE LOS ORIGINA (2026-08-14): Carolina no podía guardar el horario del
// Dr. Villegas. El martes tenía un bloque cargado y ella apretó "+ Agregar
// bloque"; el formulario insertó 08:00–17:00 a ciegas, que se cruzaba con lo que
// ya estaba, y el guardado quedó bloqueado con "tuesday: Los bloques no pueden
// solaparse" — la clave del día en inglés y sin decir qué hacer. No pudo
// corregir NINGÚN día, porque un solo error frena el guardado entero.
//
// Lo que protegen estos tests:
//   1. Apretar "+" nunca deja el formulario roto sin haber escrito nada.
//   2. Un renglón en blanco no bloquea el guardado.
//   3. Un bloque a medio llenar SÍ avisa (ahí hubo intención), y dice cuál.
//   4. Los mensajes nombran el bloque y dicen qué hacer.
// ============================================================

import {
  validateBlocks, stripEmptyBlocks, isBlockEmpty, defaultBlock, DAY_LABELS,
} from '@/lib/utils/working-hours'
import type { WorkingBlock } from '@/types/database'

let pass = 0
let fail = 0
function check(nombre: string, ok: boolean, detalle?: string) {
  if (ok) { pass++; console.log(`  ✅ ${nombre}`) }
  else { fail++; console.log(`  ❌ ${nombre}${detalle ? `\n       ${detalle}` : ''}`) }
}

console.log('\n➕ AGREGAR UN BLOQUE NO PUEDE ROMPER EL FORMULARIO\n')
{
  const vacio = defaultBlock([])
  check('día sin bloques → propone 08:00–17:00', vacio.start === '08:00' && vacio.end === '17:00')

  // El caso de Carolina: el martes del Dr. Villegas.
  const martes: WorkingBlock[] = [{ start: '10:00', end: '23:00' }]
  const nuevo = defaultBlock(martes)
  check(
    'sobre 10:00–23:00 NO propone algo que se cruce',
    isBlockEmpty(nuevo) || validateBlocks([...martes, nuevo]) === null,
    `propuso ${JSON.stringify(nuevo)} → ${validateBlocks([...martes, nuevo])}`,
  )

  const manana: WorkingBlock[] = [{ start: '08:00', end: '11:00' }]
  const tarde = defaultBlock(manana)
  check('sobre 08:00–11:00 propone 11:00–12:00', tarde.start === '11:00' && tarde.end === '12:00')
  check('y ese par valida limpio', validateBlocks([...manana, tarde]) === null)

  const hastaElFinal: WorkingBlock[] = [{ start: '08:00', end: '23:30' }]
  check('si no queda lugar en el día → bloque vacío, no uno roto', isBlockEmpty(defaultBlock(hastaElFinal)))
}

console.log('\n🧹 UN RENGLÓN EN BLANCO NO BLOQUEA EL GUARDADO\n')
{
  const conVacio: WorkingBlock[] = [{ start: '10:00', end: '11:00' }, { start: '', end: '' }]
  check('se detecta como vacío', isBlockEmpty(conVacio[1]))
  check('stripEmptyBlocks lo saca y deja el resto', stripEmptyBlocks(conVacio).length === 1)
  check('y lo que queda valida OK', validateBlocks(stripEmptyBlocks(conVacio)) === null)
}

console.log('\n⚠️  UN BLOQUE A MEDIO LLENAR SÍ AVISA, Y DICE CUÁL\n')
{
  const faltaFin: WorkingBlock[] = [{ start: '10:00', end: '11:00' }, { start: '14:00', end: '' }]
  check('no se descarta silenciosamente', stripEmptyBlocks(faltaFin).length === 2)
  const err = validateBlocks(faltaFin)
  check('devuelve error', err !== null)
  check('nombra el bloque 2', !!err?.includes('bloque 2'), err ?? '')
  check('dice que falta la hora de fin', !!err?.includes('de fin'), err ?? '')
  check('dice cómo salir (borrarlo)', !!err?.includes('borrá'), err ?? '')

  const faltaInicio = validateBlocks([{ start: '', end: '11:00' }])
  check('el que le falta el inicio lo dice distinto', !!faltaInicio?.includes('de inicio'), faltaInicio ?? '')
}

console.log('\n🔀 SOLAPAMIENTO: DICE QUÉ DOS BLOQUES Y CON QUÉ HORAS\n')
{
  const cruzados: WorkingBlock[] = [{ start: '10:00', end: '23:00' }, { start: '08:00', end: '17:00' }]
  const err = validateBlocks(cruzados)
  check('detecta el cruce', err !== null)
  check('nombra los dos bloques', !!err?.includes('bloque 1') && !!err?.includes('bloque 2'), err ?? '')
  check('muestra las horas de ambos', !!err?.includes('10:00') && !!err?.includes('08:00'), err ?? '')
  check('ya no dice el genérico viejo', err !== 'Los bloques no pueden solaparse')

  check('dos bloques que se TOCAN en el borde no se cruzan',
    validateBlocks([{ start: '08:00', end: '11:00' }, { start: '11:00', end: '13:00' }]) === null)
}

console.log('\n🇦🇷 EL DÍA VA EN ESPAÑOL\n')
{
  check('tuesday → Martes', DAY_LABELS.tuesday === 'Martes')
  check('wednesday → Miércoles', DAY_LABELS.wednesday === 'Miércoles')
  check('saturday → Sábado', DAY_LABELS.saturday === 'Sábado')
  check('están los siete', Object.keys(DAY_LABELS).length === 7)
}

console.log('\n🕐 FIN ANTES QUE INICIO\n')
{
  const err = validateBlocks([{ start: '17:00', end: '09:00' }])
  check('lo detecta', err !== null)
  check('dice cuál y con qué horas', !!err?.includes('bloque 1') && !!err?.includes('17:00'), err ?? '')
}

console.log(`\n${'─'.repeat(56)}`)
console.log(`${pass} pasaron · ${fail} fallaron`)
process.exit(fail > 0 ? 1 : 0)

export {}
