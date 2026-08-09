// ============================================================
// SOS: el convenio existe, está clasificado, y era inalcanzable.
//
// Cargado como "ENTIDAD PROMOTORA DE SALUD SERVICIO OCCIDENTAL DE SALUD S.A".
// Nadie dice eso. Y como el matcher compara subcadenas, "sos" no aparece en
// ningún lado de esa razón social. 1.653 citas históricas detrás.
//
// El riesgo del alias es el opuesto al del bug: que "sos" empiece a matchear
// cualquier cosa que la contenga. La mitad de estos tests son sobre eso.
//
// Correr: npx tsx scripts/test-convenio-alias.ts
// ============================================================

import { mismoConvenioPorAlias, normalizarConvenio } from '../src/lib/rules/convenio-aliases'

const SOS_LARGO = 'ENTIDAD PROMOTORA DE SALUD SERVICIO OCCIDENTAL DE SALUD S.A'

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

console.log('\n🔴 LAS CUATRO FORMAS QUE PEDISTE')
for (const dicho of ['SOS', 'EPS SOS', 'SOS CONTRIBUTIVO', 'SOS SUBSIDIADO']) {
  ok(`"${dicho}" encuentra la razón social`, mismoConvenioPorAlias(dicho, SOS_LARGO))
}

console.log('\nCOMO APARECE REALMENTE EN EL HISTÓRICO DE ALGIA')
for (const dicho of ['SOS PAC COMPLEMENT', 'SOS PLAN EXCELENCIA', 'sos', 'Sos Contributivo', 'S.O.S.']) {
  ok(`"${dicho}"`, mismoConvenioPorAlias(dicho, SOS_LARGO))
}

console.log('\nY CON LA RAZÓN SOCIAL ESCRITA DE OTRAS FORMAS')
for (const cargado of [
  'ENTIDAD PROMOTORA DE SALUD SERVICIO OCCIDENTAL DE SALUD S.A',
  'entidad promotora de salud servicio occidental de salud sa',
  'SERVICIO OCCIDENTAL DE SALUD',
  'S.O.S. - Servicio Occidental de Salud S.A.',
]) {
  ok(`cargado como "${cargado.slice(0, 42)}…"`, mismoConvenioPorAlias('EPS SOS', cargado))
}

console.log('\n⚠️ EL RIESGO INVERSO — "sos" NO puede matchear cualquier cosa')
const noDeberian: [string, string][] = [
  ['SOS', 'COLSANITAS'],
  ['SOS', 'ASOCOEN'],
  ['SOS', 'MEDPLUS'],
  ['SOS', 'SEGUROS BOLIVAR'],
  ['SOS', 'SURAMERICANA'],
  ['SOS', 'COOMEVA'],
  ['ASOCOEN', SOS_LARGO],
  ['COLSANITAS', SOS_LARGO],
  ['MEDPLUS', SOS_LARGO],
  ['SALUD TOTAL', SOS_LARGO],
  ['NUEVA EPS', SOS_LARGO],
]
for (const [d, c] of noDeberian) ok(`"${d}" NO matchea "${c.slice(0, 34)}"`, !mismoConvenioPorAlias(d, c))

console.log('\n"SOS" TIENE QUE SER PALABRA, NO SUBCADENA')
for (const d of ['sospecha', 'sosa', 'ASOCIACION', 'GRUPOSOS', 'sosten']) {
  ok(`"${d}" NO dispara el alias`, !mismoConvenioPorAlias(d, SOS_LARGO))
}
ok('"seguro sos" sí (es palabra)', mismoConvenioPorAlias('seguro sos', SOS_LARGO))

console.log('\nBORDES')
ok('vacío no matchea', !mismoConvenioPorAlias('', SOS_LARGO))
ok('cargado vacío no matchea', !mismoConvenioPorAlias('SOS', ''))
ok('un convenio sin alias definido no se rompe', !mismoConvenioPorAlias('COOMEVA', 'COOMEVA'))

console.log('\nNORMALIZACIÓN')
ok('tildes', normalizarConvenio('Colmédica') === 'colmedica')
ok('puntos → espacio', normalizarConvenio('S.A.') === 's a')
ok('espacios colapsados', normalizarConvenio('  SOS   EPS  ') === 'sos eps')

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
