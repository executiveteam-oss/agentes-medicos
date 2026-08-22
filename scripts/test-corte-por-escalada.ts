// Tabla de la verdad COMPLETA del corte por escalada. Sin DB, sin red.
// Recorre los 20 motivos del conjunto cerrado × (con humano / sin humano).
import { decidirCorteDeEscalada, MOTIVOS_RESERVADOS_A_HUMANO, MOTIVOS_CON_ACCION_BLOQUEADA } from '../src/lib/conversations/corte-por-escalada'
import { ESCALATION_REASONS, type EscalationReason } from '../src/lib/conversations/escalation-reasons'
import { huboIntervencionHumana, type MensajeParaIntervencion } from '../src/lib/conversations/intervencion-humana'

let fallos = 0
const ok = (cond: boolean, etiqueta: string) => {
  if (!cond) { console.error(`  ❌ ${etiqueta}`); fallos++ }
}

console.log('\n═══ TABLA DE LA VERDAD — 20 motivos × 2 ═══\n')
console.log('motivo                          con humano   sin humano   acción')
console.log('─'.repeat(72))

const motivos = Object.values(ESCALATION_REASONS) as EscalationReason[]
for (const motivo of motivos) {
  const conHumano = decidirCorteDeEscalada({ status: 'escalated', escalationReason: motivo, huboRespuestaHumana: true })
  const sinHumano = decidirCorteDeEscalada({ status: 'escalated', escalationReason: motivo, huboRespuestaHumana: false })

  // INVARIANTE 1: con humano adentro, el agente SIEMPRE se calla. Sin excepción.
  ok(!conHumano.atiende && conHumano.porque === 'humano_ya_respondio', `${motivo}: con humano tendría que callarse`)
  // INVARIANTE 2: los reservados se callan aunque no haya humano.
  ok(sinHumano.atiende === !MOTIVOS_RESERVADOS_A_HUMANO.has(motivo), `${motivo}: destrabe no coincide con la lista`)

  const marca = MOTIVOS_CON_ACCION_BLOQUEADA.has(motivo) ? '🚫 no agenda' : ''
  console.log(
    `${motivo.padEnd(30)}  ${(conHumano.atiende ? 'atiende' : 'CALLA').padEnd(11)}  ${(sinHumano.atiende ? 'atiende' : 'CALLA').padEnd(11)}  ${marca}`,
  )
}

console.log('\n═══ BORDES ═══\n')

// No escalada: el corte no aplica.
ok(decidirCorteDeEscalada({ status: 'active', escalationReason: null, huboRespuestaHumana: false }).atiende, 'active tiene que atender')
ok(decidirCorteDeEscalada({ status: 'active', escalationReason: ESCALATION_REASONS.CRISIS, huboRespuestaHumana: false }).atiende, 'active atiende aunque el context traiga basura vieja')
console.log('  ✅ status != escalated → el corte no aplica')

// Motivo fuera del conjunto cerrado → silencio (sesgo seguro).
for (const raro of [null, undefined, '', 'Autorización pendiente: Mapeo con MEDPLUS', 42, {}]) {
  const d = decidirCorteDeEscalada({ status: 'escalated', escalationReason: raro, huboRespuestaHumana: false })
  ok(!d.atiende && d.porque === 'motivo_desconocido', `motivo raro (${JSON.stringify(raro)}) tendría que callar`)
}
console.log('  ✅ motivo desconocido → calla (ante la duda, silencio)')

// El caso que originó todo.
const luz = decidirCorteDeEscalada({ status: 'escalated', escalationReason: ESCALATION_REASONS.AUTHORIZATION_REVIEW, huboRespuestaHumana: false })
ok(luz.atiende && luz.accionBloqueada, 'autorizacion_recibida sin humano → atiende, con acción marcada')
console.log('  ✅ autorizacion_recibida sin humano → ATIENDE (el caso de las 32 h de silencio)')

// El servicio ruleado: conversa, pero la acción queda marcada como bloqueada.
const svc = decidirCorteDeEscalada({ status: 'escalated', escalationReason: ESCALATION_REASONS.SERVICE_RULE, huboRespuestaHumana: false })
ok(svc.atiende && svc.accionBloqueada, 'servicio ruleado → conversa con acción bloqueada')
console.log('  ✅ servicio_escalate_human sin humano → CONVERSA, acción bloqueada (la bloquea el executor)')

// Crisis: no se destraba nunca.
const crisis = decidirCorteDeEscalada({ status: 'escalated', escalationReason: ESCALATION_REASONS.CRISIS, huboRespuestaHumana: false })
ok(!crisis.atiende, 'crisis NO se destraba')
console.log('  ✅ crisis sin humano → CALLA')

// ── la fuente única de "¿hay una persona adentro?" ──────────────────────────
console.log('\n═══ ¿HUBO INTERVENCIÓN HUMANA? — misma función que usa la bandeja ═══\n')
const ESC = '2026-08-15T12:00:00Z'
const casos: Array<[string, MensajeParaIntervencion[], string | null, boolean]> = [
  ['sin mensajes',                        [],                                                              ESC,  false],
  ['sólo la paciente',                    [{ role: 'patient', created_at: '2026-08-16T12:00:00Z' }],       ESC,  false],
  ['sólo el agente',                      [{ role: 'agent',   created_at: '2026-08-16T12:00:00Z' }],       ESC,  false],
  ['staff ANTES de escalar (historia)',   [{ role: 'staff',   created_at: '2026-08-14T12:00:00Z' }],       ESC,  false],
  ['staff DESPUÉS de escalar',            [{ role: 'staff',   created_at: '2026-08-16T12:00:00Z' }],       ESC,  true],
  ['staff exactamente en escalated_at',   [{ role: 'staff',   created_at: ESC }],                          ESC,  false],
  ['staff antes Y después',               [{ role: 'staff',   created_at: '2026-08-14T12:00:00Z' },
                                           { role: 'staff',   created_at: '2026-08-16T12:00:00Z' }],       ESC,  true],
  ['sin escalated_at → cualquier staff',  [{ role: 'staff',   created_at: '2026-08-14T12:00:00Z' }],       null, true],
]
for (const [etiqueta, msgs, esc, esperado] of casos) {
  const r = huboIntervencionHumana(msgs, esc)
  ok(r === esperado, `${etiqueta}: esperaba ${esperado}, dio ${r}`)
  console.log(`  ${r === esperado ? '✅' : '❌'} ${etiqueta.padEnd(36)} → ${r ? 'hay humano adentro' : 'nadie respondió'}`)
}

console.log(fallos === 0 ? '\n✅ TODO OK\n' : `\n❌ ${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
