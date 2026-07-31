/**
 * Tests — GUARD: la entidad del registro NUNCA produce modo 'particular'.
 * Run: npx tsx scripts/test-insurer-from-record.ts
 */
import { insurerFromRecord } from '../src/lib/utils/insurer-from-record'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, got?: unknown): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label} — got: ${JSON.stringify(got)}`); fail++ }
}

console.log('Tests — insurerFromRecord (guard anti-particular)\n')

// EL GUARD: "PARTICULAR" del registro → null (nunca habilita modo particular)
assert('PARTICULAR → null', insurerFromRecord('PARTICULAR') === null)
assert('particular (minúscula) → null', insurerFromRecord('particular') === null)
assert('  Particular  (espacios) → null', insurerFromRecord('  Particular  ') === null)

// Aseguradoras reales → pasan tal cual (el agente las usa como convenio)
assert('COOMEVA MEDICINA PREPAGADA → pasa', insurerFromRecord('COOMEVA MEDICINA PREPAGADA') === 'COOMEVA MEDICINA PREPAGADA')
assert('SURAMERICANA SEG VIDA → pasa', insurerFromRecord('SURAMERICANA SEG VIDA') === 'SURAMERICANA SEG VIDA')
assert('SOS SUBSIDIADO → pasa', insurerFromRecord('SOS SUBSIDIADO') === 'SOS SUBSIDIADO')

// Marcadores de "sin aseguradora" → null (defensa para derivaciones futuras)
assert('SIN ASEGURADORA → null', insurerFromRecord('SIN ASEGURADORA') === null)
assert('NINGUNA → null', insurerFromRecord('Ninguna') === null)
assert('"-" → null', insurerFromRecord('-') === null)
assert('N/A → null', insurerFromRecord('N/A') === null)

// Vacío / null → null (sin aseguradora conocida → el agente pregunta)
assert('null → null', insurerFromRecord(null) === null)
assert('"" → null', insurerFromRecord('') === null)
assert('undefined → null', insurerFromRecord(undefined) === null)

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
