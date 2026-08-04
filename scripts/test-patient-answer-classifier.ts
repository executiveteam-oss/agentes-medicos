// Tests — clasificador determinista de respuestas patient_condition.
// Conservador: solo sí/no CLARO sin duda; todo lo demás → ambiguous (deriva).
import { classifyYesNo, classifyChoice } from '../src/lib/rules/patient-answer-classifier'

let ok = 0, fail = 0
function eq(name: string, got: string, want: string) {
  if (got === want) { ok++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} — got '${got}', want '${want}'`) }
}

console.log('sí/no claros\n')
eq('"sí"', classifyYesNo('sí'), 'yes')
eq('"Sí, claro"', classifyYesNo('Sí, claro'), 'yes')
eq('"correcto"', classifyYesNo('correcto'), 'yes')
eq('"no"', classifyYesNo('no'), 'no')
eq('"No, para nada"', classifyYesNo('No, para nada'), 'no')
eq('"nunca"', classifyYesNo('nunca'), 'no')

console.log('\nEL CASO F3 y la incertidumbre → ambiguous (deriva)\n')
eq('"no estoy segura, llevo días de atraso" (F3)', classifyYesNo('no estoy segura, llevo días de atraso'), 'ambiguous')
eq('"no sé"', classifyYesNo('no sé'), 'ambiguous')
eq('"creo que no" (tiene "no" pero es duda)', classifyYesNo('creo que no'), 'ambiguous')
eq('"creo que sí"', classifyYesNo('creo que sí'), 'ambiguous')
eq('"tal vez"', classifyYesNo('tal vez'), 'ambiguous')
eq('"puede ser"', classifyYesNo('puede ser'), 'ambiguous')
eq('"no me he hecho la prueba"', classifyYesNo('no me he hecho la prueba'), 'ambiguous')

console.log('\nSin señal clara → ambiguous (safe default)\n')
eq('"estoy embarazada" (semántico sí, sin "sí" → deriva, se loguea)', classifyYesNo('estoy embarazada'), 'ambiguous')
eq('vacío', classifyYesNo(''), 'ambiguous')
eq('"para pedir una cita"', classifyYesNo('para pedir una cita'), 'ambiguous')
eq('contradicción "sí pero no"', classifyYesNo('sí pero no'), 'ambiguous')

console.log('\nNo hay falsos positivos de substring\n')
eq('"nosotros vamos" NO es "no"', classifyYesNo('nosotros vamos'), 'ambiguous')
eq('"siempre" NO es "si"', classifyYesNo('siempre'), 'ambiguous')

console.log('\nmultiple_choice\n')
const opts = [{ id: 'primera', label: 'Primera vez' }, { id: 'control', label: 'Control' }]
eq('"control"', classifyChoice('control', opts), 'control')
eq('"vengo a control"', classifyChoice('vengo a control', opts), 'control')
eq('"primera vez"', classifyChoice('primera vez', opts), 'primera')
eq('ninguna opción → ambiguous', classifyChoice('no sé qué es', opts), 'ambiguous')
eq('ambas mencionadas → ambiguous', classifyChoice('control o primera vez', opts), 'ambiguous')

console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
if (fail > 0) process.exit(1)
