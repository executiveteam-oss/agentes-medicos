// ============================================================
// Tests de isPriceOnlyQuestion — la compuerta que evita escalar una pregunta
// de precio sobre un servicio ruleado.
//
// El caso que la originó: "¿me puede informar qué vale el mapeo?" escalaba, y
// la paciente se quedaba sin respuesta a algo que el agente sabe contestar.
//
// La regla es asimétrica a propósito: ante cualquier señal de agendar, ESCALA.
// Un falso negativo acá (no escalar algo que debía escalar) es el costo caro.
//
// Correr: npx tsx scripts/test-price-only-gate.ts
// ============================================================

import { isPriceOnlyQuestion, detectEscalateService } from '../src/lib/safety/escalate-service-matcher'

let pass = 0
let fail = 0
function t(label: string, got: boolean, want: boolean) {
  if (got === want) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label} — esperaba ${want}, dio ${got}`) }
}

console.log('\nPASAN (solo precio/cobertura → el agente responde, NO escala)')
t('el caso real que lo originó', isPriceOnlyQuestion('¿me puede informar qué vale el mapeo?'), true)
t('cuánto cuesta', isPriceOnlyQuestion('cuanto cuesta la colposcopia'), true)
t('cuánto vale, sin tildes', isPriceOnlyQuestion('cuanto vale el mapeo'), true)
t('qué precio tiene', isPriceOnlyQuestion('que precio tiene la vulvoscopia?'), true)
t('cuánto sale', isPriceOnlyQuestion('Buenas, cuánto sale una histeroscopia'), true)
t('cobertura por EPS', isPriceOnlyQuestion('la colposcopia la cubre Sura?'), true)
t('pregunta por copago', isPriceOnlyQuestion('cuál es el copago del DIU'), true)
t('valor con mayúsculas y signos', isPriceOnlyQuestion('¿QUÉ VALOR TIENE EL MAPEO?'), true)

console.log('\nESCALAN IGUAL (hay intención de agendar → manda la escalación)')
t('precio + agendar en el mismo mensaje', isPriceOnlyQuestion('cuanto vale el mapeo y me lo agendas?'), false)
t('quiero', isPriceOnlyQuestion('cuanto vale la colposcopia? la quiero'), false)
t('necesito', isPriceOnlyQuestion('necesito saber el precio de la colposcopia y necesito una cita'), false)
t('pide disponibilidad', isPriceOnlyQuestion('precio del mapeo y que disponibilidad hay'), false)
t('para cuándo', isPriceOnlyQuestion('cuanto cuesta el DIU, para cuando hay'), false)
t('menciona cita', isPriceOnlyQuestion('valor de la cita de colposcopia'), false)

console.log('\nNO SON PREGUNTA DE PRECIO (siguen escalando como siempre)')
t('pide agendar a secas', isPriceOnlyQuestion('quiero una colposcopia'), false)
t('pregunta clínica — puerta cerrada a propósito', isPriceOnlyQuestion('en que consiste el mapeo?'), false)
t('qué es — puerta cerrada a propósito', isPriceOnlyQuestion('que es una vulvoscopia'), false)
t('duele', isPriceOnlyQuestion('la colposcopia duele mucho?'), false)
t('cuánto dura', isPriceOnlyQuestion('cuanto dura el mapeo'), false)
t('mensaje vacío', isPriceOnlyQuestion(''), false)

console.log('\nLA COMPUERTA NO TOCA AL DETECTOR (sigue matcheando el servicio)')
t('mapeo se sigue detectando', detectEscalateService('cuanto vale el mapeo').matched, true)
t('colposcopia se sigue detectando', detectEscalateService('cuanto cuesta la colposcopia').matched, true)

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
