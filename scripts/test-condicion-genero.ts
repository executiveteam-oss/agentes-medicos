/** Regla mínima de género en patient_condition. npx tsx scripts/test-condicion-genero.ts */
import { omitirCondicionPorGenero, esMasculinoExplicito } from '@/lib/rules/condicion-por-genero'
let mal = 0
const ok = (n: string, real: boolean, esp: boolean) => { const b = real === esp; if (!b) mal++; console.log(`${b?'✅':'🔴'} ${n} → ${real}`) }

const EMB = '¿Estás embarazada actualmente?'
console.log('── se OMITE sólo con masculino explícito ──')
ok('gender M + pregunta de embarazo',        omitirCondicionPorGenero(EMB,'M'), true)
ok('gender masculino + embarazo',            omitirCondicionPorGenero(EMB,'masculino'), true)
console.log('\n── se PREGUNTA en todo lo demás (lado seguro) ──')
ok('gender F',                               omitirCondicionPorGenero(EMB,'F'), false)
ok('gender null',                            omitirCondicionPorGenero(EMB,null), false)
ok('gender vacío',                           omitirCondicionPorGenero(EMB,''), false)
ok('gender O (otro)',                        omitirCondicionPorGenero(EMB,'O'), false)
ok('gender desconocido "X"',                 omitirCondicionPorGenero(EMB,'X'), false)
console.log('\n── otras preguntas NO se omiten, ni para hombres ──')
ok('M + "¿tienes sangrado abundante?"',      omitirCondicionPorGenero('¿Tienes sangrado abundante?','M'), false)
ok('M + "¿usas anticoagulantes?"',           omitirCondicionPorGenero('¿Usas anticoagulantes?','M'), false)
ok('M + "¿es tu primera vez?"',              omitirCondicionPorGenero('¿Es tu primera vez?','M'), false)
console.log('\n── variantes de la pregunta de embarazo ──')
ok('M + "¿está en gestación?"',              omitirCondicionPorGenero('¿Está en gestación?','M'), true)
ok('M + "¿es usted gestante?"',              omitirCondicionPorGenero('¿Es usted gestante?','M'), true)
ok('M + "posibilidad de embarazo"',          omitirCondicionPorGenero('¿Hay posibilidad de embarazo?','M'), true)
console.log('\n── el helper de género ──')
ok('esMasculinoExplicito("M")',              esMasculinoExplicito('M'), true)
ok('esMasculinoExplicito("F")',              esMasculinoExplicito('F'), false)
ok('esMasculinoExplicito(null)',             esMasculinoExplicito(null), false)
console.log(`\n${mal===0?'✅ todo bien':`🔴 ${mal} fallas`}`)
process.exit(mal?1:0)
