/**
 * Tests del name-matcher (migración Algia un solo uso).
 *
 * Cubre canonize, tokenize, matchNames + helpers de index.
 * Sin DB, sin Playwright, sin red. Casos sintéticos solamente.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-name-matcher.ts
 */

import {
  canonize,
  tokenize,
  matchNames,
  indexByFirstAndSecondToken,
  findCandidates,
} from '../src/lib/isalud/name-matcher'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests name-matcher\n')

// ============================================================
// canonize
// ============================================================
console.log('=== canonize ===')
assert('Tildes simples: MARÍA → MARIA', canonize('MARÍA') === 'MARIA')
assert('Eñe: ÑOÑO → NONO', canonize('ÑOÑO') === 'NONO')
assert('Múltiples diacríticos: JOSÉ DUVÁN LÓPEZ JARAMILLO',
  canonize('JOSÉ DUVÁN LÓPEZ JARAMILLO') === 'JOSE DUVAN LOPEZ JARAMILLO')
assert('Mayús/minús mezclado: Juan Carlos → JUAN CARLOS',
  canonize('Juan Carlos') === 'JUAN CARLOS')
assert('Espacios dobles: "MARIA  GARCIA" → "MARIA GARCIA"',
  canonize('MARIA  GARCIA') === 'MARIA GARCIA')
assert('Espacios al inicio/fin: "  JUAN  " → "JUAN"',
  canonize('  JUAN  ') === 'JUAN')
assert('Guion: García-Pérez → GARCIA PEREZ',
  canonize('García-Pérez') === 'GARCIA PEREZ')
assert('Coma: GARCIA, MARIA → GARCIA MARIA',
  canonize('GARCIA, MARIA') === 'GARCIA MARIA')
assert('Punto: M. GARCIA → M GARCIA',
  canonize('M. GARCIA') === 'M GARCIA')
assert('Vacío: "" → ""', canonize('') === '')
assert('Solo espacios: "   " → ""', canonize('   ') === '')
assert('Tabs y newlines: "MARIA\\t\\nGARCIA" → "MARIA GARCIA"',
  canonize('MARIA\t\nGARCIA') === 'MARIA GARCIA')

// ============================================================
// tokenize
// ============================================================
console.log('\n=== tokenize ===')
{
  const t = tokenize('MARIA GARCIA')
  assert('Simple: 2 tokens, ambos sustantivos',
    t.full.length === 2 && t.sustantivos.length === 2 &&
    t.full[0] === 'MARIA' && t.full[1] === 'GARCIA')
}
{
  const t = tokenize('MARIA DE LA CRUZ')
  assert('Partícula DE LA: full=4, sustantivos=2',
    t.full.length === 4 && t.sustantivos.length === 2 &&
    t.sustantivos[0] === 'MARIA' && t.sustantivos[1] === 'CRUZ')
}
{
  const t = tokenize('JOSE Y MARIA GARCIA')
  assert('Partícula Y: full=4, sustantivos=3',
    t.full.length === 4 && t.sustantivos.length === 3)
}
{
  const t = tokenize('SAN JOSE')
  assert('Partícula SAN: full=2, sustantivos=1',
    t.full.length === 2 && t.sustantivos.length === 1 &&
    t.sustantivos[0] === 'JOSE')
}
{
  const t = tokenize('')
  assert('Vacío: full=0, sustantivos=0',
    t.full.length === 0 && t.sustantivos.length === 0)
}

// ============================================================
// matchNames — exact (confidence 1.0)
// ============================================================
console.log('\n=== matchNames: exact ===')
{
  const m = matchNames('MARIA GARCIA', 'MARIA GARCIA')
  assert('Mismo string', m.type === 'exact' && m.confidence === 1.0)
}
{
  const m = matchNames('MARÍA GARCÍA', 'MARIA GARCIA')
  assert('Tildes vs sin tildes', m.type === 'exact' && m.confidence === 1.0)
}
{
  const m = matchNames('María García', 'MARIA GARCIA')
  assert('Case distinto', m.type === 'exact' && m.confidence === 1.0)
}
{
  const m = matchNames('MARIA  GARCIA', 'MARIA GARCIA')
  assert('Espacios dobles', m.type === 'exact' && m.confidence === 1.0)
}
{
  const m = matchNames('  María García  ', 'MARIA GARCIA')
  assert('Whitespace edges', m.type === 'exact' && m.confidence === 1.0)
}
{
  const m = matchNames('GARCIA-PEREZ', 'GARCIA PEREZ')
  assert('Guion vs espacio', m.type === 'exact' && m.confidence === 1.0)
}
{
  const m = matchNames('JOSÉ DUVÁN LÓPEZ JARAMILLO', 'JOSE DUVAN LOPEZ JARAMILLO')
  assert('Nombre real con varias tildes',
    m.type === 'exact' && m.confidence === 1.0)
}

// ============================================================
// matchNames — exact ignorando partículas (confidence 0.99)
// ============================================================
console.log('\n=== matchNames: exact ignorando partículas ===')
{
  const m = matchNames('MARIA DE LA CRUZ', 'MARIA CRUZ')
  assert('Con DE LA vs sin partículas',
    m.type === 'exact' && m.confidence === 0.99)
}
{
  const m = matchNames('JOSE Y MARIA GARCIA', 'JOSE MARIA GARCIA')
  assert('Con Y vs sin Y',
    m.type === 'exact' && m.confidence === 0.99)
}
{
  const m = matchNames('LOPEZ DEL CASTILLO', 'LOPEZ CASTILLO')
  assert('Con DEL vs sin DEL',
    m.type === 'exact' && m.confidence === 0.99)
}

// ============================================================
// matchNames — subset_strict (confidence 0.95)
// ============================================================
console.log('\n=== matchNames: subset_strict ===')
{
  const m = matchNames('MARIA ALEJANDRA GARCIA PEREZ', 'MARIA GARCIA PEREZ')
  assert('iSalud tiene segundo nombre extra',
    m.type === 'subset_strict' && m.confidence === 0.95)
}
{
  const m = matchNames('MARIA GARCIA PEREZ', 'MARIA ALEJANDRA GARCIA PEREZ')
  assert('appt tiene segundo nombre extra (lados invertidos)',
    m.type === 'subset_strict' && m.confidence === 0.95)
}
{
  const m = matchNames('JUAN PEDRO CARLOS GARCIA HERNANDEZ', 'JUAN GARCIA HERNANDEZ')
  assert('iSalud tiene 2 nombres extra',
    m.type === 'subset_strict' && m.confidence === 0.95)
}
{
  const m = matchNames('JUAN GARCIA LOPEZ HERNANDEZ', 'JUAN GARCIA HERNANDEZ')
  assert('iSalud tiene apellido extra en medio',
    m.type === 'subset_strict' && m.confidence === 0.95)
}

// ============================================================
// matchNames — subset_loose (confidence 0.75)
// ============================================================
console.log('\n=== matchNames: subset_loose ===')
{
  const m = matchNames('MARIA HERNANDEZ GARCIA LOPEZ', 'MARIA GARCIA')
  assert('Subsequence pero último token de appt no es último de iSalud',
    m.type === 'subset_loose' && m.confidence === 0.75)
}
{
  const m = matchNames('MARIA GARCIA HERNANDEZ LOPEZ', 'MARIA HERNANDEZ')
  assert('Subsequence pero apellido medio, no extremos',
    m.type === 'subset_loose' && m.confidence === 0.75)
}
{
  const m = matchNames('PEDRO MARIA GARCIA', 'MARIA GARCIA')
  assert('Subseq pero primer token de appt no es primero de iSalud',
    m.type === 'subset_loose' && m.confidence === 0.75)
}

// ============================================================
// matchNames — partial_first_last (confidence 0.60)
// ============================================================
console.log('\n=== matchNames: partial_first_last ===')
{
  const m = matchNames('MARIA PEDRO LUIS GARCIA', 'MARIA LUCIA JUAN GARCIA')
  assert('Extremos OK pero medios totalmente distintos',
    m.type === 'partial_first_last' && m.confidence === 0.60)
}
{
  const m = matchNames('MARIA GARCIA', 'MARIA PEREZ GARCIA')
  assert('Apellido medio distinto, extremos OK pero subseq false',
    // Esto: shorter=[MARIA, GARCIA], longer=[MARIA, PEREZ, GARCIA]
    // isSubsequence([MARIA, GARCIA], [MARIA, PEREZ, GARCIA]) → MARIA pos 0, GARCIA pos 2. → TRUE
    // Entonces es subset_strict (extremos OK + subseq)
    m.type === 'subset_strict' && m.confidence === 0.95)
}
{
  const m = matchNames('MARIA PEREZ LUIS', 'MARIA GARCIA JUAN LUIS')
  assert('PEREZ en uno, GARCIA JUAN en otro, extremos coinciden, no subseq',
    m.type === 'partial_first_last' && m.confidence === 0.60)
}

// ============================================================
// matchNames — no_match
// ============================================================
console.log('\n=== matchNames: no_match ===')
{
  const m = matchNames('JUAN GOMEZ', 'MARIA LOPEZ')
  assert('Distintos totalmente', m.type === 'no_match' && m.confidence === 0)
}
{
  const m = matchNames('JOSE GARCIA', 'MARIA GARCIA')
  assert('Mismo apellido, distinto primer nombre',
    m.type === 'no_match' && m.confidence === 0)
}
{
  const m = matchNames('JUAN', 'JUAN')
  // Mismo canon, exact con confidence 1.0
  assert('Un solo token, mismo → exact', m.type === 'exact')
}
{
  const m = matchNames('JUAN', 'MARIA')
  assert('Un solo token, distinto → no_match', m.type === 'no_match')
}
{
  const m = matchNames('JUAN', 'JUAN GARCIA')
  // shorter=[JUAN] tiene length 1, regla "necesita >= 2 tokens" → no_match
  assert('1 token vs 2 tokens (mismo primero) → no_match',
    m.type === 'no_match' && m.confidence === 0)
}
{
  const m = matchNames('', 'MARIA GARCIA')
  assert('Vacío → no_match', m.type === 'no_match')
}
{
  const m = matchNames('MARIA GARCIA', '')
  assert('Otro vacío → no_match', m.type === 'no_match')
}

// ============================================================
// matchNames — casos sintéticos del README
// ============================================================
console.log('\n=== matchNames: casos del documento de diseño ===')
{
  const m = matchNames('JUAN PEDRO', 'JUAN GARCIA')
  assert('Mismo primer nombre, segundo distinto, 2 tokens c/u → no_match',
    m.type === 'no_match')
}
{
  // shorter=[MARIA, GARCIA, LOPEZ], longer=[MARIA, PEREZ, LOPEZ]
  // extremos OK (MARIA, LOPEZ), pero subseq false (GARCIA no en longer)
  const m = matchNames('MARIA PEREZ LOPEZ', 'MARIA GARCIA LOPEZ')
  assert('Apellido paterno distinto, materno igual, ambos 3 tokens',
    m.type === 'partial_first_last')
}

// ============================================================
// indexByFirstAndSecondToken + findCandidates
// ============================================================
console.log('\n=== indexing helpers ===')
{
  const names = [
    'MARIA GARCIA LOPEZ',
    'MARIA PEREZ HERNANDEZ',
    'JUAN GARCIA',
    'PEDRO JUAN LOPEZ',
  ]
  const idx = indexByFirstAndSecondToken(names)
  assert('byFirst tiene MARIA con 2 nombres',
    (idx.byFirst.get('MARIA')?.length ?? 0) === 2)
  assert('byFirst tiene JUAN con 1 nombre',
    (idx.byFirst.get('JUAN')?.length ?? 0) === 1)
  assert('byFirst tiene PEDRO con 1 nombre',
    (idx.byFirst.get('PEDRO')?.length ?? 0) === 1)
  assert('bySecond tiene JUAN con 1 nombre (PEDRO JUAN LOPEZ)',
    (idx.bySecond.get('JUAN')?.length ?? 0) === 1)
  // GARCIA aparece como segundo token en 2 nombres: MARIA GARCIA LOPEZ y JUAN GARCIA
  assert('bySecond tiene GARCIA con 2 (MARIA GARCIA LOPEZ + JUAN GARCIA)',
    (idx.bySecond.get('GARCIA')?.length ?? 0) === 2)
}
{
  const names = [
    'MARIA GARCIA',
    'MARIA PEREZ',
    'JUAN GARCIA',
  ]
  const idx = indexByFirstAndSecondToken(names)
  // Buscar candidatos para "MARIA LOPEZ": primer token MARIA, segundo LOPEZ
  // byFirst.get(MARIA) → [MARIA GARCIA, MARIA PEREZ]
  // bySecond.get(MARIA) → nada
  // byFirst.get(LOPEZ) → nada
  // bySecond.get(LOPEZ) → nada
  // → candidates = [MARIA GARCIA, MARIA PEREZ]
  const cands = findCandidates('MARIA LOPEZ', idx)
  assert('findCandidates por primer token: 2 candidatos',
    cands.length === 2 && cands.includes('MARIA GARCIA') && cands.includes('MARIA PEREZ'))
}
{
  const names = ['MARIA GARCIA', 'JUAN HERNANDEZ']
  const idx = indexByFirstAndSecondToken(names)
  const cands = findCandidates('PEDRO LOPEZ', idx)
  assert('findCandidates sin matches: 0 candidatos',
    cands.length === 0)
}
{
  // Caso: cliente iSalud "JOSE JUAN GARCIA" debe encontrar appt "JUAN GARCIA HERNANDEZ"
  // (segundo token del cliente coincide con primer token del appt)
  const names = ['JUAN GARCIA HERNANDEZ']
  const idx = indexByFirstAndSecondToken(names)
  const cands = findCandidates('JOSE JUAN GARCIA', idx)
  assert('findCandidates con segundo token cliente = primero appt',
    cands.length === 1 && cands[0] === 'JUAN GARCIA HERNANDEZ')
}

// ============================================================
// Caso end-to-end — flujo típico de import
// ============================================================
console.log('\n=== end-to-end: match típico de import ===')
{
  // Simular: 5 nombres en appointments.reason de Algia
  const apptNames = [
    'MARIA GARCIA PEREZ',
    'JOSE LUIS HERNANDEZ LOPEZ',
    'ANA PATRICIA RODRIGUEZ',
    'PEDRO RAMIREZ',
    'JUAN DE LA CRUZ GOMEZ',
  ]
  const idx = indexByFirstAndSecondToken(apptNames)

  // Simular 4 clientes iSalud
  const clientes = [
    { iSalud: 'MARÍA ALEJANDRA GARCIA PÉREZ', expected: 'subset_strict' },
    { iSalud: 'JOSE LUIS HERNANDEZ LOPEZ', expected: 'exact' },
    { iSalud: 'JUAN CRUZ GOMEZ', expected: 'exact' },  // ignora DE LA
    { iSalud: 'OSCAR FERNANDEZ', expected: 'no_match' },
  ]

  for (const c of clientes) {
    const cands = findCandidates(c.iSalud, idx)
    let bestType: string = 'no_match'
    let bestConfidence = 0
    let bestName = ''
    for (const candidate of cands) {
      const m = matchNames(c.iSalud, candidate)
      if (m.confidence > bestConfidence) {
        bestType = m.type
        bestConfidence = m.confidence
        bestName = candidate
      }
    }
    assert(`"${c.iSalud}" → ${c.expected}`,
      bestType === c.expected,
      `got ${bestType}, best candidate: "${bestName}"`)
  }
}

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
if (failed > 0) process.exit(1)
