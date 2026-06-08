// scripts/test-res256-heuristics.ts
import { suggestRes256Category } from '../src/lib/utils/res256-heuristics'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests Res-256 heuristics\n')

// Ginecología (incluye histeroscopía, colposcopia ginecológica)
assert('Consulta primera vez ginecologia → Ginecología', suggestRes256Category('CONSULTA DE PRIMERA VEZ POR ESPECIALISTA EN GINECOLOGIA Y OBSTERICIA') === 'Ginecología')
assert('Consulta control ginecologia → Ginecología', suggestRes256Category('CONSULTA DE CONTROL O DE SEGUIMIENTO POR ESPECIALISTA EN GINECOLOGÍA Y OBSTETRICIA') === 'Ginecología')
assert('Histeroscopia diagnostica → Ginecología', suggestRes256Category('HISTEROSCOPIA DIAGNOSTICA') === 'Ginecología')
assert('Liberación adherencias histeroscopia → Ginecología', suggestRes256Category('LIBERACION DE ADHERENCIAS INTRALUMINALES DE UTERO POR HISTEROSCOPIA') === 'Ginecología')
assert('Biopsia endometrio histeroscopia → Ginecología', suggestRes256Category('BIOPSIA DE ENDOMETRIO Y LESION ENDOMETRIAL POR HISTEROSCOPIA +') === 'Ginecología')
assert('Ablación endometrial → Ginecología', suggestRes256Category('ABLACION ENDOMETRIAL POR HISTEROCOPIA') === 'Ginecología')

// Ecografía (todas las que mencionan ecograf)
assert('Ecografía dinámica piso pelvico → Ecografía', suggestRes256Category('EcografÍa dinÁmica de piso pelvico') === 'Ecografía')
assert('ECOGRAFIA OBSTETRICA → Ecografía', suggestRes256Category('ECOGRAFIA OBSTETRICA') === 'Ecografía')

// Resonancia
assert('Resonancia magnética → Resonancia Magnética', suggestRes256Category('RESONANCIA MAGNETICA PELVICA') === 'Resonancia Magnética')
assert('RMN abreviatura → Resonancia Magnética', suggestRes256Category('RMN ABDOMINAL') === 'Resonancia Magnética')

// Obstetricia (sin gineco compuesto)
assert('Consulta prenatal → Obstetricia', suggestRes256Category('CONSULTA PRENATAL') === 'Obstetricia')
assert('Atención parto → Obstetricia', suggestRes256Category('ATENCION DEL PARTO') === 'Obstetricia')

// Fisioterapia + paquetes → NoAplica (NO está en lista reportable)
assert('Consulta primera vez fisioterapia → NoAplica', suggestRes256Category('CONSULTA DE PRIMERA VEZ FISIOTERAPIA') === 'NoAplica')
assert('Terapia piso pelvico → NoAplica', suggestRes256Category('TERAPIA DE PISO PELVICO') === 'NoAplica')
assert('PAQ x 10 terapia → NoAplica', suggestRes256Category('PAQ X 10 TERAPIA DE PISO PELVICO 1 PAGO') === 'NoAplica')
assert('Psicología → NoAplica', suggestRes256Category('CONSULTA PSICOLOGIA') === 'NoAplica')

// Dudosos → null (NO sugerir, Lady decide)
assert('Control posquirúrgico → null', suggestRes256Category('CONSULTA CONTROL POSQUIRURGICO') === null)
assert('Entrega resultados → null', suggestRes256Category('CONSULTA ENTREGA DE RESULTADOS') === null)
assert('Coloración citología → null', suggestRes256Category('ESTUDIO DE COLORACION BASICA EN CITOLOGIA VAGINAL TUMORAL Y/O FUNCIONAL') === null)
assert('Colposcopia sola → null', suggestRes256Category('COLPOSCOPIA') === null)  // procedimiento ambiguo
assert('Yuyu test ficticio → null', suggestRes256Category('Yuyu') === null)

// Edge cases
assert('Empty string → null', suggestRes256Category('') === null)
assert('Solo espacios → null', suggestRes256Category('   ') === null)

console.log(`\n${passed} pasaron · ${failed} fallaron`)
if (failed > 0) process.exit(1)
