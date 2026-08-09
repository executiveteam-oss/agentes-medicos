// ============================================================
// Tests del conjunto cerrado de motivos de escalación.
//
// Lo que protegen, en orden de qué tan caro sale romperlo:
//
//  1. El motivo NUNCA lleva contenido adentro. Si alguien vuelve a escribir
//     "Autorización pendiente: Colposcopia con SOS", cada caso es su propio
//     grupo y el informe deja de agrupar. Ya pasó.
//  2. Escalar NO borra los pendientes. El reemplazo total del context hacía
//     desaparecer servicios_marcados y con él el lugar en la cola.
//  3. Quien ATIENDE no es la CAUSA. Si ya estaba escalada por crisis, tomarla
//     no la convierte en una escalación por takeover.
//  4. Devolver al agente no borra la evidencia.
//
// Correr: npx tsx scripts/test-escalation-reasons.ts
// ============================================================

import {
  ESCALATION_REASONS, ESCALATION_MECHANISM, ESCALATION_LABEL,
  isKnownReason, escalationContext, staffEscalationContext, historyOnReturn,
  type EscalationReason,
} from '../src/lib/conversations/escalation-reasons'

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

console.log('\nEL CONJUNTO ES CERRADO Y COMPLETO')
const todos = Object.values(ESCALATION_REASONS) as EscalationReason[]
ok(`hay ${todos.length} motivos definidos`, todos.length >= 14)
ok('ninguno se repite', new Set(todos).size === todos.length)
ok('todos tienen mecanismo', todos.every(r => !!ESCALATION_MECHANISM[r]))
ok('todos tienen etiqueta en español', todos.every(r => !!ESCALATION_LABEL[r]))

console.log('\nEL MOTIVO NO LLEVA CONTENIDO ADENTRO (la regresión de "Colposcopia con SOS")')
ok('ninguno tiene espacios', todos.every(r => !r.includes(' ')))
ok('ninguno tiene dos puntos', todos.every(r => !r.includes(':')))
ok('ninguno tiene mayúsculas', todos.every(r => r === r.toLowerCase()))
ok('ninguno pasa de 30 chars', todos.every(r => r.length <= 30))
ok('la prosa vieja NO es un motivo válido',
  !isKnownReason('Autorización pendiente de revisión: Colposcopia con SOS'))
ok('la otra prosa vieja tampoco',
  !isKnownReason('Paciente envió archivo — recepción de media deshabilitada (feature flag off)'))
ok('un motivo del conjunto sí es válido', isKnownReason(ESCALATION_REASONS.KEYWORD))
ok('undefined no es válido', !isKnownReason(undefined))

console.log('\nESCALAR NO BORRA LOS PENDIENTES')
const conPendiente = {
  servicios_marcados: ['mapeo'],
  servicios_marcados_at: '2026-08-08T10:00:00Z',
  contacto_enviado_at: '2026-08-08T11:00:00Z',
}
const trasCrisis = escalationContext(conPendiente, ESCALATION_REASONS.CRISIS)
ok('servicios_marcados sobrevive', JSON.stringify(trasCrisis.servicios_marcados) === '["mapeo"]')
ok('el reloj del servicio sobrevive', trasCrisis.servicios_marcados_at === '2026-08-08T10:00:00Z')
ok('el contacto pendiente sobrevive', trasCrisis.contacto_enviado_at === '2026-08-08T11:00:00Z')
ok('y el motivo quedó estampado', trasCrisis.escalation_reason === 'crisis')

console.log('\nEL DETALLE VA APARTE DEL MOTIVO')
const conDetalle = escalationContext(null, ESCALATION_REASONS.KEYWORD, 'médico')
ok('el motivo agrupa', conDetalle.escalation_reason === 'keyword_configurada')
ok('el detalle se lee', conDetalle.escalation_detail === 'médico')
const sinDetalle = escalationContext(null, ESCALATION_REASONS.CRISIS)
ok('sin detalle no inventa la clave', !('escalation_detail' in sinDetalle))

console.log('\nQUIEN ATIENDE NO ES LA CAUSA')
const yaEraCrisis = { escalation_reason: 'crisis', escalation_detail: null }
const tomada = staffEscalationContext(yaEraCrisis, ESCALATION_REASONS.STAFF_TAKEOVER, false)
ok('una crisis atendida SIGUE siendo crisis', tomada.escalation_reason === 'crisis')

const veniaDelAgente = { servicios_marcados: [] }
const sacada = staffEscalationContext(veniaDelAgente, ESCALATION_REASONS.STAFF_TAKEOVER, true)
ok('si la sacaron del agente, la causa SÍ es el takeover',
  sacada.escalation_reason === 'staff_takeover')

const sinMotivoPrevio = staffEscalationContext({}, ESCALATION_REASONS.STAFF_MANUAL, false)
ok('sin motivo previo, estampa el humano igual',
  sinMotivoPrevio.escalation_reason === 'staff_manual')

console.log('\nDEVOLVER AL AGENTE NO BORRA LA EVIDENCIA')
const antesDeDevolver = { escalation_reason: 'keyword_configurada', escalation_detail: 'médico' }
const h = historyOnReturn(antesDeDevolver)
const hist = h.escalation_history as { reason: string; detail: string | null }[]
ok('queda una entrada en el historial', Array.isArray(hist) && hist.length === 1)
ok('con el motivo', hist?.[0]?.reason === 'keyword_configurada')
ok('con el detalle', hist?.[0]?.detail === 'médico')
ok('y con la fecha', typeof (hist?.[0] as { devuelta_at?: string })?.devuelta_at === 'string')
ok('el motivo activo NO se arrastra', !('escalation_reason' in h))

const sinNada = historyOnReturn({})
ok('sin motivo previo no inventa historial', Object.keys(sinNada).length === 0)

// Ida y vuelta varias veces: el historial acumula, no pisa.
let ctx: Record<string, unknown> = {}
for (const r of ['crisis', 'pedido_humano', 'keyword_configurada'] as EscalationReason[]) {
  ctx = { ...historyOnReturn({ ...ctx, escalation_reason: r }) }
}
ok('tres idas y vueltas acumulan tres entradas',
  (ctx.escalation_history as unknown[]).length === 3)

// Techo del JSONB
let muchas: Record<string, unknown> = {}
for (let i = 0; i < 30; i++) muchas = { ...historyOnReturn({ ...muchas, escalation_reason: 'crisis' }) }
ok('el historial no crece sin límite (techo 20)',
  (muchas.escalation_history as unknown[]).length === 20)

console.log('\nMECANISMOS — la pregunta 1 de la rúbrica se contesta con una constante')
ok('crisis es Capa 0', ESCALATION_MECHANISM[ESCALATION_REASONS.CRISIS] === 'capa_0')
ok('keyword es keyword', ESCALATION_MECHANISM[ESCALATION_REASONS.KEYWORD] === 'keyword')
ok('el tool es tool_agente', ESCALATION_MECHANISM[ESCALATION_REASONS.AGENT_TOOL] === 'tool_agente')
ok('la falla de agendamiento es técnica',
  ESCALATION_MECHANISM[ESCALATION_REASONS.BOOKING_FAILURE] === 'falla_tecnica')
ok('el takeover es humano', ESCALATION_MECHANISM[ESCALATION_REASONS.STAFF_TAKEOVER] === 'humano')

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
