import { detectEscalateService, findUncoveredEscalateServices } from '../src/lib/safety/escalate-service-matcher'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests — escalación determinista de servicios (escalate_human)\n')

// --- POSITIVOS: paciente nombra el servicio ruleado (DEBEN disparar) ---
const pos = [
  'quiero una colposcopia',
  'necesito agendar colposcopia',
  'me mandaron a hacer una vulvoscopia',
  'me van a hacer una biopsia de endometrio',
  'tengo orden para histeroscopia',
  'necesito un control posquirurgico',
  'consulta de control post quirurgico',       // con espacio
  'quiero que me pongan el diu',
  'me van a colocar un dispositivo intrauterino',
  'quiero que me retiren el diu',
  'sacar el diu',
]
for (const t of pos) assert(`ESCALA+ "${t}"`, detectEscalateService(t).matched, 'no disparó')

// --- COLPOSCOPIA 10/10: fraseos variados, TODOS deben escalar (determinista) ---
const colpo10 = [
  'quiero una colposcopia',
  'necesito agendar una colposcopia',
  'me mandaron a hacer una colposcopia',
  'hola, quiero cita para colposcopia',
  'tengo orden de colposcopia',
  'la doctora me pidió una colposcopia',
  'necesito colposcopia urgente',
  'quiero saber el precio de la colposcopia',   // over-detect OK → escala igual
  'me pueden hacer una colposcopía',            // con tilde → normaliza
  'COLPOSCOPIA por favor',                        // mayúsculas → normaliza
]
let colpoHits = 0
for (const t of colpo10) if (detectEscalateService(t).matched) colpoHits++
assert(`COLPOSCOPIA 10/10 (determinista): ${colpoHits}/10 escalan`, colpoHits === 10, `solo ${colpoHits}/10`)

// --- OVER-DETECT tolerado (DEBEN disparar aunque no sea el objetivo, per usuario) ---
const overDetect = [
  'me hicieron una colposcopia el año pasado, quiero un control',  // caso textual del usuario
  'ya me pusieron el diu, tengo una duda',
]
for (const t of overDetect) assert(`OVER+ "${t}"`, detectEscalateService(t).matched, 'over-detect debe disparar')

// --- NEGATIVOS (NO deben disparar — no nombran servicio ruleado) ---
const neg = [
  'quiero una cita',
  'quiero cita de ginecología',
  'necesito una consulta de control',           // "control" solo ≠ posquirúrgico
  'quiero un control prenatal',                  // prenatal, no ruleado
  'consulta de primera vez',
  'necesito una ecografía',
  'quiero cita con la Dra. Angélica',
  'tengo dolor pélvico',
]
for (const t of neg) assert(`NEG- "${t}"`, !detectEscalateService(t).matched, 'FALSO POSITIVO')

// --- COBERTURA: los 6 procedimientos ruleados reales de Algia están cubiertos ---
const realRuledNames = [
  'BIOPSIA DE ENDOMETRIO Y LESION ENDOMETRIAL POR HISTEROSCOPIA +',
  'COLPOSCOPIA',
  'COLPOSCOPIA SOD',
  'CONSULTA CONTROL POSQUIRURGICO',
  'INSERCION DE DISPOSITIVO INTRAUTERINO ANTICONCEPTIVO (DIU) SOD +',
  'INSERCION DE DISPOSITIVO INTRAUTERINO ANTICONCEPTIVO SIN DISPOSITIVO',
  'Retiro de DIU',
  'VULVOSCOPIA',
]
const uncoveredNow = findUncoveredEscalateServices(realRuledNames)
assert('cobertura: 0 servicios ruleados de Algia sin cubrir', uncoveredNow.length === 0, `descubiertos: ${uncoveredNow.join(' | ')}`)

// --- COBERTURA: un servicio ruleado NUEVO no cubierto se detecta (anti-desync) ---
const withNew = [...realRuledNames, 'CAUTERIZACION DE CUELLO UTERINO']
const uncoveredNew = findUncoveredEscalateServices(withNew)
assert('cobertura: detecta un servicio nuevo sin keyword', uncoveredNew.length === 1 && uncoveredNew[0].includes('CAUTERIZACION'), `resultado: ${uncoveredNew.join(' | ')}`)

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
