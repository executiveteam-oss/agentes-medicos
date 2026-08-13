// ============================================================
// El monólogo interno del modelo no le llega a la paciente.
//
// A Juliana Montoya le llegó, textual, el 2026-08-13:
//   "Tienes razón. Debo llamar create_appointment ahora con los datos
//    confirmados. Déjame obtener primero el ID de la cita actual del paciente."
//
// El riesgo del filtro es el OPUESTO al bug: que se coma texto real. Por eso la
// mitad de estos tests verifican que los mensajes legítimos pasan intactos.
//
// Correr: npx tsx scripts/test-strip-monologue.ts
// ============================================================
import { stripInternalMonologue, esMonologoInterno } from '../src/lib/whatsapp/strip-internal-monologue'

let pass = 0, fail = 0
function ok(l: string, c: boolean) { if (c) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}`) } }

console.log('\n🔴 EL CASO REAL DE JULIANA')
const real = 'Tienes razón. Debo llamar create_appointment ahora con los datos confirmados.\n\nDéjame obtener primero el ID de la cita actual del paciente.\n\nPerfecto, Juliana. Tu cita quedó para el lunes 17 a las 11:00 AM.'
const r = stripInternalMonologue(real)
ok('saca el "Debo llamar create_appointment"', !r.text.includes('create_appointment'))
ok('saca el "Déjame obtener primero el ID"', !/obtener primero el ID/i.test(r.text))
ok('🔴 CONSERVA lo que sí era para ella', r.text.includes('lunes 17 a las 11:00 AM'))
ok('cuenta los bloques removidos', r.removidos === 2)

console.log('\nOTRAS FORMAS DE MONÓLOGO')
for (const t of [
  'Debo llamar a la herramienta check_availability',
  'Voy a usar la función create_appointment',
  'Déjame ejecutar la tool de disponibilidad',
  'Tienes razón. Debo verificar eso primero.',
  'Ahora necesito obtener el id de la cita',
]) ok(`"${t.slice(0, 44)}…"`, esMonologoInterno(t))

console.log('\n🔴 LO QUE NO SE PUEDE COMER (el riesgo inverso)')
for (const t of [
  'Perfecto, Juliana. Tu cita quedó para el lunes 17 a las 11:00 AM.',
  'Déjame revisar la disponibilidad del Dr. Juan Diego.',
  'Voy a coordinar con el equipo y te confirmo.',
  'Tienes razón, disculpa. El 19 es miércoles.',
  '✅ Cita confirmada — Lunes 17 de agosto a las 11:00 AM',
  'Te espero el jueves 20 a las 8:00 AM en Oval Médica.',
  '¿Confirmas esta fecha y hora?',
]) ok(`pasa: "${t.slice(0, 46)}…"`, !esMonologoInterno(t))

console.log('\nBORDES')
ok('texto sin monólogo queda idéntico',
  stripInternalMonologue('Hola, ¿en qué te ayudo?').text === 'Hola, ¿en qué te ayudo?')
ok('si TODO es monólogo, no deja a la paciente sin mensaje',
  stripInternalMonologue('Debo llamar create_appointment').text === 'Debo llamar create_appointment')
ok('vacío no rompe', stripInternalMonologue('').text === '')
ok('sin bloques removidos → removidos = 0', stripInternalMonologue('Hola').removidos === 0)

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
