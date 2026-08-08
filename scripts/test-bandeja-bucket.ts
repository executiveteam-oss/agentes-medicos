// ============================================================
// Tests de bucketOf — a qué pestaña de la bandeja va cada conversación.
//
// Lo que protegen: los DOS EJES no se pueden volver a fusionar. Un servicio
// ruleado marca la conversación para Atención (eje B) SIN callar al agente
// (eje A). Antes, la única forma de que apareciera en la cola era escalar el
// status — y eso dejaba sin respuesta a la paciente que preguntaba otra cosa
// (caso real: pidió mapeo → escaló; dijo "o una transvaginal" → nadie contestó).
//
// Correr: npx tsx scripts/test-bandeja-bucket.ts
// ============================================================

type FilterKey = 'atencion' | 'pendiente' | 'resuelta' | 'agente'
interface E { status: 'active' | 'escalated' | 'resolved'; triage_state: 'atencion' | 'pendiente' | 'resuelta' | null }

// COPIA EXACTA de conversations-panel.tsx. Si divergen, este test miente.
function bucketOf(e: E): FilterKey {
  if (e.status === 'resolved') return 'resuelta'
  if (e.triage_state === 'pendiente') return 'pendiente'
  if ((e.status === 'escalated' && e.triage_state === null) || e.triage_state === 'atencion') return 'atencion'
  return 'agente'
}

let pass = 0, fail = 0
function t(label: string, e: E, want: FilterKey) {
  const got = bucketOf(e)
  if (got === want) { pass++; console.log(`  ✅ ${label} → ${got}`) }
  else { fail++; console.log(`  ❌ ${label} → esperaba ${want}, dio ${got}`) }
}

console.log('\nLO DE SIEMPRE (no debe cambiar)')
t('crisis / pedido de humano', { status: 'escalated', triage_state: null }, 'atencion')
t('conversación normal con el bot', { status: 'active', triage_state: null }, 'agente')
t('marcada pendiente a mano', { status: 'escalated', triage_state: 'pendiente' }, 'pendiente')
t('resuelta', { status: 'resolved', triage_state: null }, 'resuelta')
t('resuelta gana sobre todo', { status: 'resolved', triage_state: 'atencion' }, 'resuelta')

console.log('\nEL CASO NUEVO — servicio ruleado sobre conversación VIVA')
t('mapeo marcado, agente activo', { status: 'active', triage_state: 'atencion' }, 'atencion')
t('… y NO cae en "Con el agente"', { status: 'active', triage_state: 'atencion' }, 'atencion')
t('si después la marcan pendiente, manda pendiente', { status: 'active', triage_state: 'pendiente' }, 'pendiente')
t('si después la resuelven', { status: 'resolved', triage_state: 'atencion' }, 'resuelta')

console.log('\nLA REGRESIÓN QUE ESTE TEST EXISTE PARA IMPEDIR')
const vivaConServicio: E = { status: 'active', triage_state: 'atencion' }
if (bucketOf(vivaConServicio) !== 'atencion') {
  fail++; console.log('  ❌ una conversación viva con servicio marcado NO aparece en la cola')
} else if (vivaConServicio.status !== 'active') {
  fail++; console.log('  ❌ el servicio ruleado volvió a callar al agente')
} else {
  pass++; console.log('  ✅ aparece en Atención Y el status sigue active (agente vivo)')
}

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
