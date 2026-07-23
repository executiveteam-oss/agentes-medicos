import { toTitleCase } from '../src/lib/utils/normalize-name'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests toTitleCase (nombre de médico → nombre de cuenta)\n')

const cases: [string, string][] = [
  ['ANGELICA  MARIA QUINTERO MONTAÑO', 'Angelica Maria Quintero Montaño'],  // mayúsculas + doble espacio + ñ
  ['JUAN DIEGO VILLEGAS ECHEVERRI', 'Juan Diego Villegas Echeverri'],
  ['JOSÉ DUVÁN LÓPEZ JARAMILLO', 'José Duván López Jaramillo'],             // tildes
  ['MARÍA JOSÉ', 'María José'],
  ['LINA', 'Lina'],                                                          // un solo nombre
  ['jorge dario', 'Jorge Dario'],                                           // ya minúsculas
  ['  extra   spaces  ', 'Extra Spaces'],                                   // trim + colapsa espacios
  ['', ''],                                                                  // vacío
]
for (const [input, expected] of cases) {
  const got = toTitleCase(input)
  assert(`"${input}" → "${expected}"`, got === expected, `got "${got}"`)
}

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
