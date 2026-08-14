// ============================================================
// Tests de ESTADOS_TERMINALES — la lista que decide qué NO pisa el sync.
//
// Es una lista, no una función, pero protege una regla asimétrica que ya costó
// caro: 22 de 22 citas de iSalud canceladas desde el dashboard fueron revividas
// a 'confirmed' por el sync, una por hora, durante ~50 días.
//
// Lo que protege este test es que nadie AGREGUE 'confirmed' o 'blocked_external'
// a la lista (congelaría el sync: dejaría de actualizar las citas vivas) ni
// SAQUE uno de los cuatro terminales (vuelve el bug).
// ============================================================

import { ESTADOS_TERMINALES } from '@/lib/isalud/sync-agent'

let pass = 0
let fail = 0

function check(nombre: string, ok: boolean) {
  if (ok) { pass++; console.log(`  ✅ ${nombre}`) }
  else { fail++; console.log(`  ❌ ${nombre}`) }
}

console.log('\n🛑 ESTADOS QUE EL SYNC NO DEBE REVIVIR\n')
for (const estado of ['cancelled', 'rescheduled', 'completed', 'no_show']) {
  check(`'${estado}' es terminal → el sync saltea la fila`, ESTADOS_TERMINALES.has(estado))
}

console.log('\n🔄 ESTADOS VIVOS — el sync TIENE que seguir moviéndolos\n')
for (const estado of ['confirmed', 'blocked_external']) {
  check(`'${estado}' NO es terminal → el sync lo actualiza`, !ESTADOS_TERMINALES.has(estado))
}

console.log('\n📋 LA LISTA ES EXACTAMENTE ESTA\n')
check(
  'son 4 estados, ni uno más',
  ESTADOS_TERMINALES.size === 4,
)
check(
  'un estado inventado no cuela',
  !ESTADOS_TERMINALES.has('cancelado') && !ESTADOS_TERMINALES.has('CANCELLED'),
)

console.log(`\n${'─'.repeat(52)}`)
console.log(`${pass} pasaron · ${fail} fallaron`)
process.exit(fail > 0 ? 1 : 0)

export {}
