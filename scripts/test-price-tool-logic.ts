import { normalizePaymentMode, decidePriceResponse } from '../src/lib/rules/price-tool-logic'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

// --- normalizePaymentMode ---
assert('exacto "particular"', normalizePaymentMode('particular') === 'particular')
assert('"PARTICULAR" → particular', normalizePaymentMode('PARTICULAR') === 'particular')
assert('"particular " (espacio) → particular', normalizePaymentMode('particular ') === 'particular')
assert('"  Particular  " → particular', normalizePaymentMode('  Particular  ') === 'particular')
assert('"eps" → eps', normalizePaymentMode('eps') === 'eps')
assert('"EPS Sura" → eps', normalizePaymentMode('EPS Sura') === 'eps')
assert('"prepagada" → prepagada', normalizePaymentMode('prepagada') === 'prepagada')
assert('"prepagada MEDPLUS" → prepagada (seguro)', normalizePaymentMode('prepagada MEDPLUS') === 'prepagada')
assert('"prepagadá" con tilde → prepagada', normalizePaymentMode('prepagadá') === 'prepagada')
assert('vacío → unknown', normalizePaymentMode('') === 'unknown')
assert('null → unknown', normalizePaymentMode(null) === 'unknown')
assert('basura "asdf" → unknown', normalizePaymentMode('asdf') === 'unknown')
assert('aseguradora suelta "medplus" → unknown (no asume)', normalizePaymentMode('medplus') === 'unknown')

// --- decidePriceResponse ---
const particularCt = { name: 'Ecografía de Mapeo', price: 264720, eps_name: null }
const convenioCt = { name: 'Colposcopia', price: 250000, eps_name: 'COOMEVA MEDICINA PREPAGADA SA' }
const particularSinPrecio = { name: 'Consulta X', price: null, eps_name: null }

// modo unknown → siempre pregunta, nunca precio
assert('unknown → ask_mode', decidePriceResponse(particularCt, 'unknown').action === 'ask_mode')
// modo eps/prepagada → copago, NUNCA tarifa (ni siquiera si el CT tiene price)
const eps = decidePriceResponse(convenioCt, 'eps')
assert('eps → copago_eps', eps.action === 'convenio_copago_eps')
assert('eps NO incluye la tarifa 250.000', !eps.message.includes('250') && eps.price === undefined)
const prep = decidePriceResponse(particularCt, 'prepagada')
assert('prepagada → copago_prepagada', prep.action === 'convenio_copago_prepagada')
assert('prepagada NO incluye precio', prep.price === undefined && !/\d{3}/.test(prep.message.replace('plan','')))
// modo particular + CT particular → precio exacto
const q = decidePriceResponse(particularCt, 'particular')
assert('particular + CT particular → quote_particular', q.action === 'quote_particular' && q.price === 264720)
assert('quote incluye el precio formateado', q.message.includes('264.720'))
// SEGUNDA RED: particular pero CT es de convenio → NO da tarifa
const guard = decidePriceResponse(convenioCt, 'particular')
assert('particular + CT convenio → no_particular_price (defensa)', guard.action === 'no_particular_price')
assert('esa defensa NO filtra la tarifa 250.000', !guard.message.includes('250') && guard.price === undefined)
// particular sin precio configurado → no_particular_price
assert('particular + CT sin precio → no_particular_price', decidePriceResponse(particularSinPrecio, 'particular').action === 'no_particular_price')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
