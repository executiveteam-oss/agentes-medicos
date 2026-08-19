/**
 * Guard 7 — test puro, sin DB ni red. Los casos salen de mensajes REALES del
 * agente entre el 08 y el 18/08/2026.
 *
 * Run: npx tsx scripts/test-guard7-promesa-sin-escalar.ts
 */
import { detectPromesaDeHumanoSinEscalar } from '../src/lib/whatsapp/agent-guards'

let passed = 0, failed = 0
function check(label: string, texto: string, opts: { tools?: string[]; yaEscala?: boolean }, esperado: boolean) {
  const r = detectPromesaDeHumanoSinEscalar({
    agentText: texto,
    toolsUsed: opts.tools ?? [],
    yaVaAEscalar: opts.yaEscala ?? false,
  })
  const ok = r.blocked === esperado
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label} — esperaba blocked=${esperado}, dio ${r.blocked}`); failed++ }
}

console.log('\n═══ DEBE disparar — promesas reales que nunca se cumplieron ═══')
check('escalar con la secretaria',
  'Déjame escalar esto con la secretaria para que te los hagan llegar pronto por este mismo chat.', {}, true)
check('ya les avisé + te contactan',
  'Voy a pasarte con un asesor del consultorio. Ya les avisé y te contactan en los próximos minutos.', {}, true)
check('el equipo te contacta',
  'El equipo te contacta pronto para confirmar tu cita y coordinar la mejor fecha.', {}, true)
check('el equipo está revisando',
  'Gracias por tu paciencia. El equipo está revisando y te contactarán pronto para confirmar tu cita.', {}, true)
check('coordinar con el equipo',
  'Voy a coordinar con el equipo para que te envíen los documentos pendientes de tu cita.', {}, true)
check('un asesor te contacta',
  '¡De nada! Un asesor te contacta pronto para confirmar tu cita.', {}, true)

console.log('\n═══ NO debe disparar — señuelos (el agente resuelve solo) ═══')
check('te confirmo en un momento', 'Perfecto, te confirmo en un momento el horario disponible.', {}, false)
check('déjame revisar', 'Déjame revisar la disponibilidad del Dr. Juan Diego para ese día.', {}, false)
check('dame un momento', 'Dame un momento mientras verifico tu cita.', {}, false)
check('voy a revisar tu ficha', 'Voy a revisar tu ficha y te digo enseguida.', {}, false)
check('un momento por favor', 'Un momento por favor, estoy consultando la agenda.', {}, false)
check('confirmación de cita normal',
  '✅ Cita confirmada con el Dr. Juan Diego Villegas 📅 Martes 18 de agosto a las 2:00 PM', {}, false)
check('derivar a teléfono NO es promesa de contacto',
  'Para trámites administrativos comunícate con la clínica: 📞 +573046650214', {}, false)

console.log('\n═══ NO debe disparar — la conversación YA escala ═══')
check('llamó escalate_to_human',
  'Ya les avisé y te contactan pronto.', { tools: ['escalate_to_human'] }, false)
check('corte determinista (agentResponse.escalate)',
  'Uy, tuve un inconveniente para agendar tu cita 🙁 Ya avisé a una persona del equipo para que lo revise y te confirme enseguida.',
  { yaEscala: true }, false)
check('capa 2: servicio no existe con ese médico',
  'Ese servicio no lo atiende el Dr. Jorge. Ya le pasé tu caso a una persona del consultorio para que te oriente.',
  { yaEscala: true }, false)

// ============================================================
// GUARD 8 — negó una cita que ella sostiene que tiene
// ============================================================
import { detectCitaNegadaQueEllaAfirma } from '../src/lib/whatsapp/agent-guards'

function check8(label: string, agente: string, paciente: string, opts: { tools?: string[]; yaEscala?: boolean }, esperado: boolean) {
  const r = detectCitaNegadaQueEllaAfirma({
    agentText: agente, patientText: paciente,
    toolsUsed: opts.tools ?? [], yaVaAEscalar: opts.yaEscala ?? false,
  })
  const ok = r.blocked === esperado
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label} — esperaba ${esperado}, dio ${r.blocked}`); failed++ }
}

console.log('\n═══ GUARD 8 · DEBE disparar ═══')
check8('pide reagendar y no la encuentra',
  'Déjame revisar tu cita actual: No veo citas programadas en tu perfil actualmente.',
  'Me puedes colaborar con reagendarme esta cita si son tan amables', {}, true)
check8('dice "mi cita" y el agente la niega',
  'En este momento no tienes citas programadas en nuestro sistema.',
  'Quiero confirmar mi cita de mañana', {}, true)
check8('dice que ya tenía una',
  'Revisé tu agenda y en este momento no tienes ninguna cita confirmada.',
  'Yo tenía una cita el jueves pasado y me la cancelaron', {}, true)


console.log('\n═══ GUARD 8 · NO debe disparar ═══')
// ⚠️ LÍMITE CONOCIDO del guard 8, escrito acá para que no se descubra tarde:
// el caso real que originó todo esto NO lo atrapa. La paciente escribió
// "Es a las 2? O a las 2:20?" — presupone la cita pero no la afirma con
// ninguna palabra del patrón. Ampliar la regex para cubrir preguntas de hora
// haría disparar a cualquiera que pregunta un horario, que es la mitad de las
// conversaciones.
//
// Ese caso ya está arreglado en la RAÍZ: la tool usa el patient_id resuelto y
// devuelve sus tres citas. El guard es el backstop para lo que quede, no el
// arreglo de ese caso.
check8('LÍMITE: pregunta por la hora sin nombrar la cita → no dispara',
  'Disculpa, no tengo registrada una cita tuya en este momento.',
  'Es a las 2? O a las 2:20?', {}, false)

check8('quiere agendar por primera vez (no afirma nada)',
  'No tienes citas programadas. ¿Te gustaría agendar una?',
  'Hola, quiero agendar una cita con ginecología', {}, false)
check8('es sobre el convenio, no sobre una cita',
  'No tengo registrado ese convenio, pero eso no quiere decir que no exista 🙂',
  'Mi cita la cubre Colmédica?', {}, false)
check8('ya escaló por la tool',
  'No veo citas programadas en tu perfil.',
  'Quiero reagendar mi cita', { tools: ['escalate_to_human'] }, false)
check8('ya escala por corte determinista',
  'No veo citas programadas en tu perfil.',
  'Quiero reagendar mi cita', { yaEscala: true }, false)
check8('el agente SÍ encontró la cita',
  '✅ Tienes una cita confirmada para mañana a las 10:00 AM.',
  'Quiero confirmar mi cita', {}, false)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
