/**
 * Guard 10 — afirmó un convenio sin consultarlo. Puro, sin DB.
 * Run: npx tsx scripts/test-guard-convenio.ts
 */
import { detectConvenioSinVerificar } from '@/lib/whatsapp/agent-guards'
let mal = 0
function check(nombre: string, texto: string, tools: string[], debe: boolean) {
  const r = detectConvenioSinVerificar({ agentText: texto, toolsUsed: tools })
  const ok = r.blocked === debe
  if (!ok) mal++
  console.log(`${ok ? '✅' : '🔴'} ${nombre}  (bloqueó=${r.blocked})`)
}
const SIN: string[] = []
const CON = ['check_eps_convenio']

// Los casos REALES medidos el 21/08 contra el agente.
check('🔴 "Sí, tenemos convenio con Nueva EPS" sin tool', 'Sí, tenemos convenio con Nueva EPS. ¿Vas a usarla para la cita?', SIN, true)
check('🔴 "Sí, atendemos Plan Zafiro" sin tool', 'Sí, atendemos Plan Zafiro. Es una de nuestras aseguradoras con convenio.', SIN, true)
check('🔴 "Sí, atendemos pacientes con SOS" sin tool', 'Sí, atendemos pacientes con SOS. ¿Quieres agendar?', SIN, true)
check('🔴 niega sin tool', 'No, no tenemos convenio con Nueva EPS.', SIN, true)

// Con la tool llamada, pasa (el dato salió de la fuente).
check('afirma DESPUÉS de llamar la tool', 'Sí, tenemos convenio con COLMEDICA. ¿La vas a usar?', CON, false)

// El corte determinista de convenio no reconocido: ya escaló, no se toca.
check('el texto del corte por convenio no reconocido',
  'No tengo registrado ese convenio, pero eso no quiere decir que no exista 🙂 Ya le pedí al equipo del consultorio que lo confirme.', SIN, false)

// Cosas que NO son una afirmación de convenio.
check('pregunta si usa convenio o particular', '¿Vas a usar tu aseguradora o prefieres ir como particular?', SIN, false)
check('habla de especialidades, no de convenios', 'En ALGIA atendemos Fisioterapia, Psicología, Ginecología, Radiología y Colposcopia.', SIN, false)
check('habla del horario', 'Atendemos de lunes a viernes de 8:00 AM a 6:00 PM.', SIN, false)
check('confirma una cita', '✅ Cita confirmada con el Dr. Jorge el lunes 24 a las 7:00 AM.', SIN, false)
check('dice que va como particular', 'Perfecto, entonces vas como particular. El valor es $50.750.', SIN, false)

console.log(`\n${mal === 0 ? '✅ todo bien' : `🔴 ${mal} fallas`}`)
process.exit(mal ? 1 : 0)
