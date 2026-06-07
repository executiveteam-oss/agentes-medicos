import { findEapbCodeByName, getEapbCodeFromInsurerOption } from '../src/lib/utils/eapb-codes'
import { INSURER_OPTIONS } from '../src/lib/utils/insurer-options'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests EAPB codes\n')

// findEapbCodeByName: lookup desde texto libre (e.g. patients.eps o appointments.eps_name)
assert('"COOMEVA MEDICINA PREPAGADA S.A" → PRE003', findEapbCodeByName('COOMEVA MEDICINA PREPAGADA S.A') === 'PRE003')
assert('"colsanitas" → PRE001', findEapbCodeByName('colsanitas') === 'PRE001')
assert('"Nueva EPS" → EPS037', findEapbCodeByName('Nueva EPS') === 'EPS037')
assert('"Sura" → null (ambiguo, no decide solo)', findEapbCodeByName('Sura') === null)
assert('"ALLIANZ SEGUROS DE VIDA S.A" → PRE005', findEapbCodeByName('ALLIANZ SEGUROS DE VIDA S.A') === 'PRE005')
assert('"asdfg" → null', findEapbCodeByName('asdfg') === null)
assert('"" → null', findEapbCodeByName('') === null)
assert('null → null', findEapbCodeByName(null) === null)
assert('Particular → "NA" (sentinel para particular)', findEapbCodeByName('Particular') === 'NA')

// getEapbCodeFromInsurerOption: combina insurer-options + tipo confirmado
const sura = INSURER_OPTIONS.find(o => o.name === 'Sura')!
assert('Sura + tipo EPS → EPS005', getEapbCodeFromInsurerOption(sura, 'EPS') === 'EPS005')
assert('Sura + tipo Prepagada → PRE002', getEapbCodeFromInsurerOption(sura, 'Prepagada') === 'PRE002')

const coomeva = INSURER_OPTIONS.find(o => o.name === 'Coomeva Prepagada')!
assert('Coomeva Prepagada (no ambigua) → PRE003 sin tipo', getEapbCodeFromInsurerOption(coomeva, null) === 'PRE003')

console.log(`\n${passed} pasaron · ${failed} fallaron`)
if (failed > 0) process.exit(1)
