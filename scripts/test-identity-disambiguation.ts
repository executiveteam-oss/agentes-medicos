/**
 * Tests — desambiguación determinista de identidad (teléfono compartido).
 * Run: npx tsx scripts/test-identity-disambiguation.ts
 */
import { resolveIdentityFromReply, type PatientCandidate } from '../src/lib/patients/identity-disambiguation'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void { if (ok) { console.log(`  ✅ ${label}`); pass++ } else { console.log(`  ❌ ${label}`); fail++ } }

console.log('Tests — resolveIdentityFromReply\n')

const maria: PatientCandidate = { id: 'p1', name: 'MARIA GONZALEZ RUIZ', document_number: '43111222' }
const ana: PatientCandidate   = { id: 'p2', name: 'ANA GONZALEZ RUIZ',   document_number: '1088333444' }
const fam = [maria, ana]

// Documento
assert('documento exacto → match único', resolveIdentityFromReply('43111222', fam).resolved?.id === 'p1')
assert('documento con puntos → normaliza y matchea', resolveIdentityFromReply('43.111.222', fam).resolved?.id === 'p1')
assert('documento del otro → matchea al otro', resolveIdentityFromReply('mi cc es 1088333444', fam).resolved?.id === 'p2')
assert('documento inexistente → no_match', resolveIdentityFromReply('99999999', fam).reason === 'no_match')

// Nombre
assert('nombre completo → match único', resolveIdentityFromReply('María González Ruiz', fam).resolved?.id === 'p1')
assert('nombre con tildes/mayúsculas → normaliza', resolveIdentityFromReply('ANA GONZÁLEZ', fam).resolved?.id === 'p2')
assert('solo primer nombre (1 token) → no_match (evita adivinar)', resolveIdentityFromReply('maria', fam).reason === 'no_match')
assert('apellido compartido solo (1 token útil) → no_match', resolveIdentityFromReply('gonzalez', fam).reason === 'no_match')

// Ambigüedad real (mismo nombre en dos candidatos)
const gemelas = [
  { id: 'g1', name: 'LAURA PEREZ', document_number: '1090111222' },
  { id: 'g2', name: 'LAURA PEREZ', document_number: '1090333444' },
]
assert('dos candidatos mismo nombre completo → multiple_match (no resuelve)', resolveIdentityFromReply('Laura Perez', gemelas).reason === 'multiple_match')
assert('dos candidatos mismo nombre → resolved null', resolveIdentityFromReply('Laura Perez', gemelas).resolved === null)
assert('gemelas: documento desempata', resolveIdentityFromReply('1090333444', gemelas).resolved?.id === 'g2')

// Familiares con mismo apellido: el nombre de pila desambigua (más tokens gana)
assert('mismo apellido, nombre de pila distingue → resuelve al de más tokens',
  resolveIdentityFromReply('María González Ruiz', fam).resolved?.id === 'p1')

// Bordes
assert('respuesta vacía → no_match', resolveIdentityFromReply('', fam).reason === 'no_match')
assert('sin candidatos → no_match', resolveIdentityFromReply('María González', []).reason === 'no_match')
assert('frase con el nombre embebido → match', resolveIdentityFromReply('hola soy maria gonzalez', fam).resolved?.id === 'p1')
assert('candidato sin documento + respuesta numérica corta → cae a nombre (no_match)',
  resolveIdentityFromReply('123', [{ id: 'x', name: 'PEPE LOPEZ', document_number: null }]).reason === 'no_match')

// Privacidad: el módulo solo devuelve el candidato resuelto o null — nunca una lista
const r = resolveIdentityFromReply('gonzalez', fam)
assert('cuando no resuelve, no devuelve candidatos (solo null)', r.resolved === null && !('candidates' in r))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
