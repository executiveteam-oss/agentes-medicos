/**
 * ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
 *
 * Tests para src/lib/isalud/consulta-convenio-derivation.ts
 *
 * 34 tests sobre lógica pura:
 *   Suite 1 (5):  parseAseguradora
 *   Suite 2 (8):  canonicalizeConvenio
 *   Suite 3 (8):  mapToEapbCode
 *   Suite 4 (6):  deriveDuration (umbral default = 5)
 *   Suite 5 (3):  matchProcedureToStaging
 *   Suite 6 (4):  deriveSuggestions end-to-end con fixtures
 *
 * Run: npx tsx scripts/test-consulta-convenio-derivation.ts
 */

import {
  parseAseguradora,
  canonicalizeConvenio,
  mapToEapbCode,
  matchProcedureToStaging,
  derivePriceSource,
  deriveDuration,
  deriveSuggestions,
  EAPB_CODE_PARTICULAR,
  type CitaForDerivation,
  type EapbCodeForDerivation,
  type StagingProductForDerivation,
} from '../src/lib/isalud/consulta-convenio-derivation'

// --- Test runner ---

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
  } catch (err) {
    failed++
    const msg = err instanceof Error ? err.message : String(err)
    failures.push(`  ❌ ${name}\n     ${msg}`)
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${label}\n     expected: ${e}\n     actual:   ${a}`)
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// --- Fixtures compartidas ---

const REAL_EAPB_CODES: EapbCodeForDerivation[] = [
  { code: 'PRE001', name: 'Colsanitas', type: 'Prepagada', aliases: ['colsanitas'] },
  { code: 'PRE003', name: 'Coomeva Prepagada', type: 'Prepagada', aliases: ['coomeva', 'coomeva prepagada', 'coomeva medicina prepagada'] },
  { code: 'PRE004', name: 'Colmédica', type: 'Prepagada', aliases: ['colmedica', 'colmédica'] },
  { code: 'PRE005', name: 'Allianz Salud', type: 'Prepagada', aliases: ['allianz', 'allianz salud', 'allianz seguros de vida'] },
  { code: 'PRE006', name: 'AXA Colpatria Prepagada', type: 'Prepagada', aliases: ['axa', 'axa colpatria', 'colpatria'] },
  { code: 'PRE007', name: 'MediPlus', type: 'Prepagada', aliases: ['mediplus', 'medi plus'] },
  { code: 'EPS002', name: 'SOS', type: 'EPS', aliases: ['sos', 'servicio occidental de salud'] },
  { code: 'EPS005', name: 'Sura EPS', type: 'EPS', aliases: ['sura', 'sura eps', 'suramericana eps'] },
  { code: 'PRE002', name: 'Sura Prepagada', type: 'Prepagada', aliases: ['sura prepagada'] },
  { code: 'EPS013', name: 'Comfenalco', type: 'EPS', aliases: ['comfenalco'] },
]

// --- Suite 1: parseAseguradora (5 tests) ---

console.log('\n=== Suite 1: parseAseguradora ===\n')

test('S1.1: standard format', () => {
  const out = parseAseguradora('COOMEVA MEDICINA PREPAGADARégimen: EspecialTipo afiliado: Tomador/Amparado')
  assertEq(out, 'COOMEVA MEDICINA PREPAGADA', 'extract before Régimen')
})

test('S1.2: PARTICULAR format', () => {
  const out = parseAseguradora('PARTICULARRégimen: ParticularTipo afiliado: Cotizante')
  assertEq(out, 'PARTICULAR', 'PARTICULAR extracted')
})

test('S1.3: multi-word with caps and spaces', () => {
  const out = parseAseguradora('ALLIANZ  SEGUROS DE VIDA S.ARégimen: EspecialTipo afiliado: Tomador')
  assertEq(out, 'ALLIANZ  SEGUROS DE VIDA S.A', 'preserves internal spaces')
})

test('S1.4: missing Régimen marker → null', () => {
  const out = parseAseguradora('SOLO NOMBRE SIN MARCADOR')
  assertEq(out, null, 'null when format unexpected')
})

test('S1.5: null and empty string', () => {
  assertEq(parseAseguradora(null), null, 'null in → null out')
  assertEq(parseAseguradora(''), null, 'empty in → null out')
})

// --- Suite 2: canonicalizeConvenio (8 tests) ---

console.log('\n=== Suite 2: canonicalizeConvenio ===\n')

test('S2.1: ALLIANZ + variant suffix → ALLIANZ', () => {
  assertEq(canonicalizeConvenio('ALLIANZ CARE'), 'ALLIANZ', 'ALLIANZ CARE collapsed')
})

test('S2.2: ALLIANZ base name → ALLIANZ', () => {
  assertEq(canonicalizeConvenio('ALLIANZ SEGUROS DE VIDA S.A'), 'ALLIANZ', 'full name collapsed')
})

test('S2.3: SOS + régimen → SOS', () => {
  assertEq(canonicalizeConvenio('SOS CONTRIBUTIVO'), 'SOS', 'régimen stripped')
  assertEq(canonicalizeConvenio('SOS SUBSIDIADO'), 'SOS', 'subsidiado stripped')
})

test('S2.4: COLMEDICA + categoría → COLMEDICA', () => {
  assertEq(canonicalizeConvenio('COLMEDICA VERDE-NOGAL-ESMERALDA'), 'COLMEDICA', 'category collapsed')
  assertEq(canonicalizeConvenio('COLMEDICA MEDICINA PREPAGADA S.A'), 'COLMEDICA', 'suffix collapsed')
})

test('S2.5: AXA COLPATRIA + variants → AXA COLPATRIA (orden de prefixes importa)', () => {
  assertEq(canonicalizeConvenio('AXA COLPATRIA MEDICINA PREPAGADA S.A'), 'AXA COLPATRIA', 'multi-word prefix wins over AXA')
  assertEq(canonicalizeConvenio('AXA COLPATRIA - SEGUROS DE VIDA'), 'AXA COLPATRIA', 'with hyphen')
})

test('S2.6: SURAMERICANA variants → SURAMERICANA', () => {
  assertEq(canonicalizeConvenio('SURAMERICANA SEG VIDA'), 'SURAMERICANA', 'space-separated suffix')
  assertEq(canonicalizeConvenio('SURAMERICANA CLASICO'), 'SURAMERICANA', 'classic suffix')
})

test('S2.7: sin variante conocida → pasa tal cual UPPER+TRIM', () => {
  assertEq(canonicalizeConvenio('CALCULASER'), 'CALCULASER', 'unknown name preserved')
  assertEq(canonicalizeConvenio('  calculaser  '), 'CALCULASER', 'normalized to UPPER+TRIM')
})

test('S2.8: PARTICULAR → PARTICULAR (caso especial)', () => {
  assertEq(canonicalizeConvenio('PARTICULAR'), 'PARTICULAR', 'particular special case')
})

// --- Suite 3: mapToEapbCode (8 tests) ---

console.log('\n=== Suite 3: mapToEapbCode ===\n')

test('S3.1: match exacto via alias simple', () => {
  const m = mapToEapbCode('COLSANITAS', REAL_EAPB_CODES)
  assertEq(m, { code: 'PRE001', name: 'Colsanitas', type: 'Prepagada' }, 'colsanitas match')
})

test('S3.2: match via alias case-insensitive y multi-word', () => {
  const m = mapToEapbCode('COOMEVA', REAL_EAPB_CODES)
  assertEq(m, { code: 'PRE003', name: 'Coomeva Prepagada', type: 'Prepagada' }, 'coomeva match')
})

test('S3.3: alias contenido en canonical (substring)', () => {
  // 'allianz' está contenido en 'ALLIANZ' → match
  const m = mapToEapbCode('ALLIANZ', REAL_EAPB_CODES)
  assertEq(m?.code, 'PRE005', 'allianz via substring')
})

test('S3.4: PARTICULAR → caso especial NA', () => {
  const m = mapToEapbCode('PARTICULAR', REAL_EAPB_CODES)
  assertEq(m, { code: EAPB_CODE_PARTICULAR, name: 'Particular', type: 'Particular' }, 'particular = NA')
})

test('S3.5: PARTICULAR funciona incluso con eapb_codes vacío', () => {
  const m = mapToEapbCode('PARTICULAR', [])
  assertEq(m?.code, EAPB_CODE_PARTICULAR, 'particular works without catalog')
})

test('S3.6: sin match → null', () => {
  const m = mapToEapbCode('CALCULASER', REAL_EAPB_CODES)
  assertEq(m, null, 'unknown convenio returns null')
})

test('S3.7: ambiguo (mismo alias en 2 eapb_codes) → null', () => {
  const ambigCodes: EapbCodeForDerivation[] = [
    { code: 'X1', name: 'Health EPS', type: 'EPS', aliases: ['health'] },
    { code: 'X2', name: 'Health Prepagada', type: 'Prepagada', aliases: ['health'] },
  ]
  const m = mapToEapbCode('HEALTH PLUS', ambigCodes)
  assertEq(m, null, 'ambiguous → null')
})

test('S3.8: tildes en canonical matchean alias sin tildes', () => {
  const m = mapToEapbCode('COLMÉDICA', REAL_EAPB_CODES)
  assertEq(m?.code, 'PRE004', 'accent-insensitive match')
})

test('S3.9: short-alias guard — alias ≤4 chars en canonical mucho más largo → null', () => {
  // alias 'sura' (4 chars) está en 'SURAMERICANA' (12 chars). Sin la guard,
  // matchearía Sura EPS. Con la guard, se excluye ese alias específico.
  // Otros aliases de Sura ('sura eps', 'suramericana eps') NO son substring
  // de 'suramericana' (son más largos), así que no matchean.
  // Resultado: null → Lady decide EPS vs Prepagada al confirmar.
  const m = mapToEapbCode('SURAMERICANA', REAL_EAPB_CODES)
  assertEq(m, null, 'short alias to long canonical → not auto-match')
})

test('S3.10: short-alias guard NO afecta cuando alias=canonical (mismo length)', () => {
  // Edge case: SOS canonical 3 chars, alias 'sos' 3 chars. alias.length=3 ≤ 4,
  // pero canonical.length=3 NO >= 2*3=6. Guard no se aplica. Match normal.
  const m = mapToEapbCode('SOS', REAL_EAPB_CODES)
  assertEq(m?.code, 'EPS002', 'same-length short alias still matches')
})

// --- Suite 4: deriveDuration (6 tests, umbral default = 5) ---

console.log('\n=== Suite 4: deriveDuration ===\n')

test('S4.1: 5 citas (en umbral default) → derivada, mediana', () => {
  const r = deriveDuration([30, 30, 45, 30, 30])
  assertEq(r, { value: 30, source: 'derived', sampleSize: 5 }, '5 ≥ 5 → derived')
})

test('S4.2: 3 citas con threshold custom=3 → derivada', () => {
  const r = deriveDuration([30, 45, 60], { threshold: 3 })
  assertEq(r, { value: 45, source: 'derived', sampleSize: 3 }, 'median of [30,45,60] = 45')
})

test('S4.3: 4 citas (default 5) → fallback default 30', () => {
  const r = deriveDuration([30, 30, 45, 30])
  assertEq(r, { value: 30, source: 'default', sampleSize: 4 }, '4 < 5 → default')
})

test('S4.4: 1 cita → default', () => {
  const r = deriveDuration([120])
  assertEq(r, { value: 30, source: 'default', sampleSize: 1 }, 'single sample → default')
})

test('S4.5: empty → default', () => {
  const r = deriveDuration([])
  assertEq(r, { value: 30, source: 'default', sampleSize: 0 }, 'empty → default')
})

test('S4.6: NaN se filtra antes de evaluar umbral', () => {
  const r = deriveDuration([30, NaN, 45, NaN, 30, 30, 45])
  // valid = [30,45,30,30,45], length 5, median 30
  assertEq(r, { value: 30, source: 'derived', sampleSize: 5 }, 'NaN filtered out')
})

test('S4.7: length PAR — promedio de los 2 centrales redondeado', () => {
  // 6 valores >= 5 → derivada. Sorted: [30,40,40,50,50,60]
  // Length par: mediana = round((sorted[2] + sorted[3]) / 2) = round((40 + 50)/2) = 45
  const r = deriveDuration([30, 40, 40, 50, 50, 60])
  assertEq(r, { value: 45, source: 'derived', sampleSize: 6 }, 'even-length median averaged')
})

// --- Suite 5: matchProcedureToStaging ---

console.log('\n=== Suite 5: matchProcedureToStaging ===\n')

const TEST_STAGING: StagingProductForDerivation[] = [
  { id: 's1', producto_nombre: 'TERAPIA DE PISO PELVICO', convenio_nombre: 'COOMEVA', tarifa: 150000, convenio_nit: null },
  { id: 's2', producto_nombre: 'CONSULTA DE PRIMERA VEZ POR ESPECIALISTA EN GINECOLOGIA Y OBSTETRICIA', convenio_nombre: 'ALLIANZ', tarifa: 100000, convenio_nit: null },
  { id: 's3', producto_nombre: 'ECOGRAFIA PELVICA', convenio_nombre: 'COLSANITAS', tarifa: 80000, convenio_nit: null },
]

// Tests originales — comportamiento sin convenio especificado (null) o convenio que NO matchea
test('S5.1: match exacto case-insensitive (sin convenio)', () => {
  const m = matchProcedureToStaging('Terapia de piso pelvico', null, TEST_STAGING)
  assertEq(m?.productoId, 's1', 'exact match case-insensitive')
})

test('S5.2: match por prefijo (raw es prefijo del producto_nombre)', () => {
  const m = matchProcedureToStaging('consulta de primera vez por especialista en ginecologia', null, TEST_STAGING)
  assertEq(m?.productoId, 's2', 'prefix match')
})

test('S5.3: no match → null', () => {
  const m = matchProcedureToStaging('Vm', null, TEST_STAGING)
  assertEq(m, null, 'no match')
})

// --- Fix bug #2 (ARG-2026-06-23): match prefiere convenio ---
// Staging con MISMO procedimiento × DOS convenios distintos × tarifas distintas.
// El bug viejo devolvía siempre el primero. El fix debe elegir el del convenio correcto.

const TEST_STAGING_MULTI_CONVENIO: StagingProductForDerivation[] = [
  { id: 'colp-coomeva',  producto_nombre: 'COLPOSCOPIA', convenio_nombre: 'COOMEVA MEDICINA PREPAGADA',    tarifa: 250000, convenio_nit: null },
  { id: 'colp-allianz',  producto_nombre: 'COLPOSCOPIA', convenio_nombre: 'ALLIANZ SEGUROS DE VIDA S.A',   tarifa: 450000, convenio_nit: null },
  { id: 'colp-sanitas',  producto_nombre: 'COLPOSCOPIA', convenio_nombre: 'EPS SANITAS',                   tarifa: 140000, convenio_nit: null },
  { id: 'vulvo-coomeva', producto_nombre: 'VULVOSCOPIA', convenio_nombre: 'COOMEVA MEDICINA PREPAGADA',    tarifa: 200000, convenio_nit: null },
]

test('S5.4: match exacto procedimiento + convenio → devuelve el del CONVENIO correcto', () => {
  const m = matchProcedureToStaging('COLPOSCOPIA', 'ALLIANZ SEGUROS DE VIDA S.A', TEST_STAGING_MULTI_CONVENIO)
  assertEq(m?.productoId, 'colp-allianz', 'preferido por convenio (Allianz)')
  assertEq(m?.tarifa, 450000, 'tarifa correcta del convenio Allianz')
  assertEq(m?.matchedBy, 'convenio_exact', 'matchedBy = convenio_exact')
})

test('S5.5: match con convenio distinto → cambia el resultado (NO devuelve el primero arbitrario)', () => {
  const m = matchProcedureToStaging('COLPOSCOPIA', 'EPS SANITAS', TEST_STAGING_MULTI_CONVENIO)
  assertEq(m?.productoId, 'colp-sanitas', 'preferido por convenio (Sanitas)')
  assertEq(m?.tarifa, 140000, 'tarifa Sanitas')
})

test('S5.6: match procedimiento case-insensitive + convenio case-insensitive', () => {
  const m = matchProcedureToStaging('colposcopia', 'coomeva medicina prepagada', TEST_STAGING_MULTI_CONVENIO)
  assertEq(m?.productoId, 'colp-coomeva', 'case-insensitive en ambos')
})

test('S5.7: FALLBACK procedimiento existe pero convenio no matchea → devuelve cualquiera del procedimiento', () => {
  // 'AXA COLPATRIA' no existe para COLPOSCOPIA → fallback al primer match por nombre
  const m = matchProcedureToStaging('COLPOSCOPIA', 'AXA COLPATRIA', TEST_STAGING_MULTI_CONVENIO)
  // Devuelve el primero por orden de staging (colp-coomeva)
  assertEq(m?.productoId, 'colp-coomeva', 'fallback a primer match por nombre')
  assertEq(m?.matchedBy, 'fallback_exact', 'matchedBy = fallback_exact')
})

test('S5.8: FALLBACK convenio null (PARTICULAR) → devuelve primer match por nombre', () => {
  const m = matchProcedureToStaging('COLPOSCOPIA', null, TEST_STAGING_MULTI_CONVENIO)
  assertEq(m?.productoId, 'colp-coomeva', 'sin convenio → primer match (comportamiento histórico)')
  assertEq(m?.matchedBy, 'fallback_exact', 'sin convenio → fallback')
})

test('S5.9: dos procedimientos × mismo convenio → elige el procedimiento correcto', () => {
  const m1 = matchProcedureToStaging('VULVOSCOPIA', 'COOMEVA MEDICINA PREPAGADA', TEST_STAGING_MULTI_CONVENIO)
  assertEq(m1?.productoId, 'vulvo-coomeva', 'VULVOSCOPIA + COOMEVA → vulvo-coomeva')
  const m2 = matchProcedureToStaging('COLPOSCOPIA', 'COOMEVA MEDICINA PREPAGADA', TEST_STAGING_MULTI_CONVENIO)
  assertEq(m2?.productoId, 'colp-coomeva', 'COLPOSCOPIA + COOMEVA → colp-coomeva')
})

// --- Deuda #3 (ARG-2026-06-23): derivePriceSource expone origen del precio a la UI ---

test('S5.10: derivePriceSource — match por convenio → convenio_match', () => {
  assertEq(derivePriceSource('convenio_exact', 100000), 'convenio_match', 'convenio_exact con tarifa > 0')
  assertEq(derivePriceSource('convenio_prefix', 100000), 'convenio_match', 'convenio_prefix con tarifa > 0')
})

test('S5.11: derivePriceSource — fallback → fallback (precio estimado)', () => {
  assertEq(derivePriceSource('fallback_exact', 100000), 'fallback', 'fallback_exact con tarifa > 0')
  assertEq(derivePriceSource('fallback_prefix', 100000), 'fallback', 'fallback_prefix con tarifa > 0')
})

test('S5.12: derivePriceSource — tarifa 0 o negativa → none (sin tarifa, ignorar match)', () => {
  assertEq(derivePriceSource('convenio_exact', 0), 'none', 'tarifa 0 → none aunque match real')
  assertEq(derivePriceSource('fallback_exact', 0), 'none', 'tarifa 0 → none también para fallback')
  assertEq(derivePriceSource('convenio_exact', -1), 'none', 'tarifa negativa → none')
})

// --- Suite 6: deriveSuggestions end-to-end (4 tests) ---

console.log('\n=== Suite 6: deriveSuggestions end-to-end ===\n')

function makeCita(
  doctor_id: string,
  doctor_name: string,
  proc: string,
  aseg: string,
  duration: number,
): CitaForDerivation {
  return {
    doctor_id,
    doctor_name,
    procedimiento_raw: proc,
    aseguradora_raw: `${aseg}Régimen: EspecialTipo afiliado: Tomador/Amparado`,
    duration_minutes: duration,
  }
}

test('S6.1: combo con N>=5 → duración derivada; combo con N<5 → default', () => {
  const citas: CitaForDerivation[] = [
    // Dr X, Terapia, COOMEVA — 5 citas con duración consistente
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'COOMEVA MEDICINA PREPAGADA', 45),
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'COOMEVA MEDICINA PREPAGADA', 45),
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'COOMEVA MEDICINA PREPAGADA', 45),
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'COOMEVA MEDICINA PREPAGADA', 50),
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'COOMEVA MEDICINA PREPAGADA', 45),
    // Dr X, Consulta, ALLIANZ — 2 citas (debajo umbral)
    makeCita('dx', 'DR X', 'consulta de primera vez por especialista en ginecologia', 'ALLIANZ SEGUROS DE VIDA S.A', 30),
    makeCita('dx', 'DR X', 'consulta de primera vez por especialista en ginecologia', 'ALLIANZ SEGUROS DE VIDA S.A', 30),
  ]

  const out = deriveSuggestions({ citas, stagingProducts: TEST_STAGING, eapbCodes: REAL_EAPB_CODES })

  const drX = out.suggestions.get('dx')
  assert(!!drX, 'DR X presente')
  assertEq(drX!.combinations.length, 2, '2 combos distintos')

  const terapia = drX!.combinations.find((c) => c.staging_product_id === 's1')!
  assertEq(terapia.duration_source, 'derived', 'terapia → derived')
  assertEq(terapia.duration_minutes, 45, 'mediana de [45,45,45,50,45] = 45')
  assertEq(terapia.citas_count, 5, '5 citas')
  assertEq(terapia.convenio_eapb_code, 'PRE003', 'COOMEVA → PRE003')

  const consulta = drX!.combinations.find((c) => c.staging_product_id === 's2')!
  assertEq(consulta.duration_source, 'default', 'consulta → default')
  assertEq(consulta.duration_minutes, 30, 'default 30')
  assertEq(consulta.citas_count, 2, '2 citas (debajo umbral)')
})

test('S6.2: convenio sin match eapb → needs_classification=true', () => {
  const citas: CitaForDerivation[] = [
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'CALCULASER', 30),
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'CALCULASER', 30),
  ]

  const out = deriveSuggestions({ citas, stagingProducts: TEST_STAGING, eapbCodes: REAL_EAPB_CODES })

  const drX = out.suggestions.get('dx')!
  const combo = drX.combinations[0]
  assertEq(combo.convenio_eapb_code, null, 'CALCULASER → null')
  assertEq(combo.convenio_eapb_type, null, 'type null')
  assertEq(combo.needs_classification, true, 'needs classification')
  assertEq(out.stats.combinationsNeedingClassification, 1, 'counter en stats')
})

test('S6.3: doctor sin citas → suggestions vacío', () => {
  const out = deriveSuggestions({ citas: [], stagingProducts: TEST_STAGING, eapbCodes: REAL_EAPB_CODES })
  assertEq(out.suggestions.size, 0, 'no suggestions')
  assertEq(out.stats.totalCombinations, 0, '0 combinations')
})

test('S6.5: citas con aseguradora_raw mal formateado se cuentan en stats.aseguradoraUnparseable', () => {
  const citas: CitaForDerivation[] = [
    // 1: bien parseable (cuenta como totalCitasParseable)
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'COOMEVA MEDICINA PREPAGADA', 45),
    // 2: aseguradora con texto pero sin "Régimen:" → parser falla
    {
      doctor_id: 'dx',
      doctor_name: 'DR X',
      procedimiento_raw: 'Terapia de piso pelvico',
      aseguradora_raw: 'FORMATO ROTO SIN MARCADOR',
      duration_minutes: 30,
    },
    // 3: aseguradora vacía → no cuenta como unparseable (no había data que parsear)
    {
      doctor_id: 'dx',
      doctor_name: 'DR X',
      procedimiento_raw: 'Terapia de piso pelvico',
      aseguradora_raw: '',
      duration_minutes: 30,
    },
  ]
  const out = deriveSuggestions({ citas, stagingProducts: TEST_STAGING, eapbCodes: REAL_EAPB_CODES })
  assertEq(out.stats.aseguradoraUnparseable, 1, 'solo la #2 cuenta — vacía no, parseable sí')
  assertEq(out.stats.totalCitasParseable, 1, 'solo la #1 contribuyó a una combo')
})

test('S6.4: procedimiento sin cruce con staging va a unparseable.procedimientos', () => {
  const citas: CitaForDerivation[] = [
    makeCita('dx', 'DR X', 'Vm', 'COOMEVA MEDICINA PREPAGADA', 30),
    makeCita('dx', 'DR X', 'Terapia de piso pelvico', 'COOMEVA MEDICINA PREPAGADA', 45),
  ]

  const out = deriveSuggestions({ citas, stagingProducts: TEST_STAGING, eapbCodes: REAL_EAPB_CODES })

  // "Vm" no cruza con staging → no se genera SuggestionCombo
  const drX = out.suggestions.get('dx')!
  assertEq(drX.combinations.length, 1, 'solo 1 combo válido')
  assertEq(drX.combinations[0].procedimiento_canonical, 'TERAPIA DE PISO PELVICO', 'el que cruza')
  assert(out.unparseable.procedimientos.includes('Vm'), 'Vm en unparseable')
})

// --- Reporte final ---

console.log('\n=== Resultado ===')
if (failed > 0) {
  console.log(`\n❌ Failures:\n`)
  failures.forEach((f) => console.log(f))
}
const total = passed + failed
console.log(`\n${passed} pasaron · ${failed} fallaron (total ${total})`)
process.exit(failed > 0 ? 1 : 0)
