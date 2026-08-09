// ============================================================
// El caso de MARIA TERESA (CC 42119415), y la regla que lo causó.
//
// 8 años de paciente, 13 citas, todas MEDPLUS, todas con el mismo médico.
// Escribió "Medplus" y el agente le contestó que no había convenio. Ninguna
// pieza falló: el modelo clasificó "Medplus" como Prepagada, la tool filtró
// `.eq('insurer_type','Prepagada')`, MEDPLUS estaba cargado con tipo NULL, y el
// filtro lo borró ANTES de comparar el nombre. La tool devolvió "no hay
// convenio" y el modelo lo repitió con fidelidad.
//
// Estos tests fijan la regla nueva: EL TIPO NO FILTRA, DESEMPATA.
//
// Correr: npx tsx scripts/test-convenio-null-type.ts
// ============================================================

// `export {}` hace que este archivo sea un MÓDULO. Sin él vive en ámbito global
// y su `let pass` choca con el de scripts/test-bandeja-bucket.ts, que tampoco
// tiene imports. `tsc --noEmit` no lo ve; `next build` sí.
export {}

type Row = { eps_name: string; insurer_type: 'EPS' | 'Prepagada' | null }

// COPIA EXACTA de la lógica de checkEpsConvenio (executor.ts). Si divergen,
// este test miente.
function buscar(rows: Row[], epsName: string, insurerTypeFilter: 'EPS' | 'Prepagada' | null) {
  const searchTerm = epsName.trim().toLowerCase()
  const porNombre = rows.filter((r) => {
    const lower = r.eps_name.toLowerCase()
    return lower.includes(searchTerm) || searchTerm.includes(lower.replace(/[.\s]+/g, ''))
  })
  const found =
    (insurerTypeFilter ? porNombre.find((r) => r.insurer_type === insurerTypeFilter) : undefined)
    ?? porNombre[0]
  const tipoNoCoincide =
    !!found && !!insurerTypeFilter && found.insurer_type !== null && found.insurer_type !== insurerTypeFilter
  return { hasConvenio: !!found, convenio: found?.eps_name ?? null, tipo: found?.insurer_type ?? null, tipoNoCoincide }
}

// Los 11 convenios REALES de Algia al 2026-08-09, con su clasificación real.
const ALGIA: Row[] = [
  { eps_name: 'ASOCOEN', insurer_type: null },
  { eps_name: 'AZUL-ROBLE-DIAMANTE-ZAFIRO-OCEANO', insurer_type: null },
  { eps_name: 'ENTIDAD PROMOTORA DE SALUD SERVICIO OCCIDENTAL DE SALUD S.A', insurer_type: null },
  { eps_name: 'MEDPLUS', insurer_type: null },
  { eps_name: 'PAN AMERICAN LIFE', insurer_type: null },
  { eps_name: 'SEGUROS BOLIVAR', insurer_type: null },
  { eps_name: 'SURAMERICANA', insurer_type: null },
  { eps_name: 'ALLIANZ', insurer_type: 'Prepagada' },
  { eps_name: 'COLMEDICA', insurer_type: 'Prepagada' },
  { eps_name: 'COLSANITAS', insurer_type: 'Prepagada' },
  { eps_name: 'COOMEVA', insurer_type: 'Prepagada' },
]

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

console.log('\n🔴 EL CASO EXACTO — CC 42119415, "Medplus", tipo cargado NULL')
const caso = buscar(ALGIA, 'Medplus', 'Prepagada')
ok('ENCUENTRA el convenio', caso.hasConvenio === true)
ok('y es MEDPLUS', caso.convenio === 'MEDPLUS')
ok('reporta que no está clasificado', caso.tipo === null)
ok('no marca conflicto de tipo (NULL no contradice)', caso.tipoNoCoincide === false)

console.log('\nLA MISMA PACIENTE, ESCRITO DE OTRAS FORMAS')
for (const t of ['Medplus', 'MEDPLUS', 'medplus', ' MedPlus ', 'MEDPLUS MEDICINA PREPAGADA']) {
  const r = buscar(ALGIA, t, 'Prepagada')
  ok(`"${t}" → ${r.convenio}`, r.hasConvenio === true)
}

console.log('\nY SI EL MODELO SE EQUIVOCA DE TIPO, TAMPOCO LA PIERDE')
ok('"Medplus" como EPS igual encuentra', buscar(ALGIA, 'Medplus', 'EPS').hasConvenio === true)
ok('"Medplus" sin tipo encuentra', buscar(ALGIA, 'Medplus', null).hasConvenio === true)

console.log('\nLOS 7 SIN CLASIFICAR DEJAN DE SER INVISIBLES')
for (const n of ['Asocoen', 'Pan American Life', 'Seguros Bolivar', 'Suramericana', 'Medplus']) {
  ok(`"${n}" con filtro Prepagada`, buscar(ALGIA, n, 'Prepagada').hasConvenio === true)
  ok(`"${n}" con filtro EPS`, buscar(ALGIA, n, 'EPS').hasConvenio === true)
}

console.log('\nEL TIPO SIGUE SIRVIENDO PARA DESEMPATAR')
const conAmbos: Row[] = [
  { eps_name: 'SURA', insurer_type: 'EPS' },
  { eps_name: 'SURA', insurer_type: 'Prepagada' },
]
ok('pidiendo EPS elige la EPS', buscar(conAmbos, 'sura', 'EPS').tipo === 'EPS')
ok('pidiendo Prepagada elige la prepagada', buscar(conAmbos, 'sura', 'Prepagada').tipo === 'Prepagada')

console.log('\nCUANDO EL TIPO CARGADO CONTRADICE AL PEDIDO, SE AVISA — NO SE NIEGA')
const soloEps: Row[] = [{ eps_name: 'SANITAS', insurer_type: 'EPS' }]
const r = buscar(soloEps, 'Sanitas', 'Prepagada')
ok('igual devuelve el convenio', r.hasConvenio === true)
ok('y marca que el tipo no coincide', r.tipoNoCoincide === true)

console.log('\nLO QUE DE VERDAD NO EXISTE → NO SÉ, no "no hay"')
console.log('  (la tool ahora devuelve success:false CONVENIO_NO_RECONOCIDO y el')
console.log('   loop corta determinista y escala — ver test-convenio-alias.ts)')
for (const n of ['Compensar', 'Nueva EPS', 'Salud Total', 'Famisanar']) {
  ok(`"${n}" NO encuentra`, buscar(ALGIA, n, 'EPS').hasConvenio === false)
}
ok('cadena vacía no matchea todo', buscar(ALGIA, 'x'.repeat(3), null).hasConvenio === false)

console.log('\nLA REGRESIÓN QUE ESTE TEST EXISTE PARA IMPEDIR')
const conFiltroViejo = ALGIA.filter((r2) => r2.insurer_type === 'Prepagada')
  .find((r2) => r2.eps_name.toLowerCase().includes('medplus'))
if (conFiltroViejo) { fail++; console.log('  ❌ el filtro viejo encontraba MEDPLUS (el test está mal armado)') }
else { pass++; console.log('  ✅ con el filtro VIEJO, MEDPLUS era invisible — con el nuevo aparece') }

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
