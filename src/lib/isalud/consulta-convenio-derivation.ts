// ⏳ MIGRACIÓN ALGIA — código de un solo uso. NO es feature del producto Omuwan.
// Solo se usa para la migración de Algia desde iSalud. Tiene fecha de caducidad.
// Ver sección "MIGRACIÓN ALGIA" en CLAUDE.md antes de modificar o reusar.
// ============================================================
// Consulta-Convenio Derivation — pure logic, no DB, no I/O
//
// Deriva sugerencias de combinaciones (médico × procedimiento × convenio)
// a partir de las citas iSalud históricas, para alimentar la UI doctor-first
// de configuración de consultation_types.
//
// Política clave (re-encuadrada 2026-06-10):
//   - Dato PRINCIPAL: el NOMBRE del convenio (convenio_canonical). Es lo que el
//     agente necesita para agendar ("tu cita Coomeva") y se persiste en
//     consultation_types.eps_name.
//   - Duración derivada solo si N >= minCitasForDurationMedian (default 5).
//     Con menos, default 30 + flag 'default' para que Lady revise.
//   - eapb_code: METADATO OPCIONAL. Se sugiere si hay match limpio en
//     eapb_codes (vía aliases), pero NO bloquea crear el consultation_type.
//     El campo needs_classification queda como info para la UI (badge), no
//     como gating de la confirmación. Esto es así porque:
//     (1) el agente para agendar solo necesita el nombre, no el código
//     (2) los códigos eapb_codes pueden no ser los oficiales SISPRO (ver
//         nota en CLAUDE.md "PENDIENTE CRÍTICO — Auditar eapb_codes")
//     (3) el reporte Res-256 (que sí necesita códigos oficiales) es un
//         feature separado pendiente de auditoría regulatoria
//   - PARTICULAR → eapb_code = 'NA' (consistente con Res-256 cuando se
//     ejecute la auditoría).
//   - Short-alias guard: alias muy corto (≤4 chars) contra canonical mucho
//     más largo (≥2x) no auto-matchea — null → Lady decide.
// ============================================================

// --- Constantes ---

export const EAPB_CODE_PARTICULAR = 'NA' as const
const DEFAULT_MIN_CITAS_FOR_DURATION = 5
const DEFAULT_FALLBACK_DURATION_MINUTES = 30

/**
 * Prefijos canónicos para colapsar variantes de un mismo convenio al nombre base.
 *
 * ⚠ ORDEN CRÍTICO: largo → corto.
 * Si un prefijo más corto (ej. "AXA") va antes que su versión larga
 * ("AXA COLPATRIA"), entradas como "AXA COLPATRIA MEDICINA PREPAGADA"
 * colapsarían a "AXA" en vez de "AXA COLPATRIA" — bug silencioso que
 * propaga al eapb_code equivocado.
 *
 * Si agregás un convenio nuevo:
 *   1. Ubicalo respetando el orden largo → corto
 *   2. Ejecutá scripts/test-consulta-convenio-derivation.ts antes de mergear
 *   3. Si es un prefijo corto que podría ser substring de otros, revisá
 *      que no rompa los tests existentes (Suite 2: canonicalizeConvenio)
 */
const CANONICAL_PREFIXES = [
  'AXA COLPATRIA',
  'ALLIANZ',
  'COLMEDICA',
  'COLSANITAS',
  'COOMEVA',
  'MEDPLUS',
  'SURAMERICANA',
  'SOS',
] as const

// --- Input types ---

export interface CitaForDerivation {
  doctor_id: string
  doctor_name: string
  procedimiento_raw: string | null
  aseguradora_raw: string | null
  /** Duración en minutos = (ends_at - starts_at). Si no se sabe, NaN. */
  duration_minutes: number
}

export interface StagingProductForDerivation {
  id: string
  producto_nombre: string
  convenio_nombre: string
  tarifa: number
  convenio_nit: string | null
}

export interface EapbCodeForDerivation {
  code: string
  name: string
  type: 'EPS' | 'Prepagada'
  aliases: string[]
}

export interface DerivationInput {
  citas: CitaForDerivation[]
  stagingProducts: StagingProductForDerivation[]
  eapbCodes: EapbCodeForDerivation[]
}

export interface DerivationOptions {
  /** Mínimo de citas para derivar mediana de duración. Default 5. */
  minCitasForDurationMedian?: number
  /** Duración usada cuando no hay datos suficientes. Default 30. */
  fallbackDurationMinutes?: number
}

// --- Output types ---

export type EapbType = 'EPS' | 'Prepagada' | 'Particular'

export interface EapbMatch {
  code: string
  name: string
  type: EapbType
}

/**
 * Origen del match de staging — útil para que la UI sepa si la `tarifa`
 * corresponde al convenio buscado o es un fallback de otro convenio.
 *   'convenio_exact' / 'convenio_prefix': la tarifa es REAL del convenio buscado
 *   'fallback_exact' / 'fallback_prefix': la tarifa viene de otro convenio
 *     (cuando el buscado no tenía staging propio para ese procedimiento)
 */
export type StagingMatchSource =
  | 'convenio_exact'
  | 'convenio_prefix'
  | 'fallback_exact'
  | 'fallback_prefix'

export interface StagingMatch {
  productoId: string
  productoNombre: string
  tarifa: number
  convenioNombre: string
  matchedBy: StagingMatchSource
}

/**
 * Origen del precio sugerido. Derivado del StagingMatchSource para uso en la UI.
 *   'convenio_match' → precio del convenio correcto (no requiere revisión especial)
 *   'fallback'       → precio estimado (no había tarifa propia del convenio buscado)
 *   'none'           → no hay precio sugerido (tarifa staging = 0/null o sin match)
 */
export type PriceSource = 'convenio_match' | 'fallback' | 'none'

export interface DurationResult {
  value: number
  source: 'derived' | 'default'
  sampleSize: number
}

export interface SuggestionCombo {
  procedimiento_canonical: string
  convenio_canonical: string
  convenio_eapb_code: string | null
  convenio_eapb_type: EapbType | null
  staging_product_id: string | null
  suggested_price: number | null
  /** Si el precio sugerido es del convenio correcto o un fallback de otro. */
  price_source: PriceSource
  duration_minutes: number
  duration_source: 'derived' | 'default'
  citas_count: number
  citas_with_duration: number
  /** true ⇔ convenio_eapb_code === null. Atajo para la UI. */
  needs_classification: boolean
}

export interface DoctorSuggestions {
  doctor_id: string
  doctor_name: string
  combinations: SuggestionCombo[]
}

export interface DerivationOutput {
  suggestions: Map<string, DoctorSuggestions>
  unparseable: {
    /** Procedimientos crudos que no cruzaron con el staging */
    procedimientos: string[]
    /** Convenios crudos que no parsearon o no encontraron eapb */
    convenios: string[]
  }
  stats: {
    totalCitasProcessed: number
    totalCitasParseable: number
    totalCombinations: number
    combinationsWithEapbMatch: number
    combinationsNeedingClassification: number
    /**
     * Citas con aseguradora_raw NO vacío que parseAseguradora NO pudo leer.
     * Hoy esperado = 0 (formato iSalud estable). Si sube, es señal de que
     * iSalud cambió el formato del campo y hay un agujero de derivación
     * que requiere ajustar parseAseguradora. Evita el "descarte mudo".
     */
    aseguradoraUnparseable: number
  }
}

// --- Public API (stubs para typecheck) ---

/**
 * Extrae el nombre del convenio del campo crudo de iSalud.
 *   "COOMEVA MEDICINA PREPAGADARégimen: Especial..." → "COOMEVA MEDICINA PREPAGADA"
 *   "PARTICULARRégimen: Particular..."               → "PARTICULAR"
 *   sin marcador "Régimen:"                          → null
 *   null/empty                                       → null
 */
export function parseAseguradora(raw: string | null): string | null {
  if (!raw) return null
  const match = raw.match(/^(.+?)Régimen:/)
  if (!match) return null
  const extracted = match[1].trim()
  return extracted === '' ? null : extracted
}

/**
 * Colapsa variantes del mismo convenio al nombre canónico.
 *   "ALLIANZ CARE" → "ALLIANZ"
 *   "SOS CONTRIBUTIVO" → "SOS"
 *   "COLMEDICA VERDE-NOGAL-ESMERALDA" → "COLMEDICA"
 *   "CALCULASER" (sin variante conocida) → "CALCULASER"
 *   "PARTICULAR" → "PARTICULAR"
 *
 * Ver CANONICAL_PREFIXES para la lista de reglas.
 */
export function canonicalizeConvenio(parsed: string): string {
  const upper = parsed.toUpperCase().trim()
  if (upper === '') return ''
  if (upper === 'PARTICULAR') return 'PARTICULAR'

  // Buscar prefijos (orden largo → corto en CANONICAL_PREFIXES)
  for (const prefix of CANONICAL_PREFIXES) {
    if (upper === prefix) return prefix
    // Aceptar separadores razonables después del prefijo: espacio, guión, coma, dos puntos
    if (
      upper.startsWith(prefix + ' ') ||
      upper.startsWith(prefix + '-') ||
      upper.startsWith(prefix + ':') ||
      upper.startsWith(prefix + ',')
    ) {
      return prefix
    }
  }

  return upper // sin variante conocida → pasa tal cual (post UPPER+TRIM)
}

/**
 * Mapea un nombre canónico al eapb_code via aliases.
 *   "Colsanitas" + aliases ["colsanitas"] → {code: "PRE001", type: "Prepagada"}
 *   "PARTICULAR" → {code: "NA", type: "Particular"} (caso especial)
 *   "CALCULASER" (sin alias match) → null
 *   "SURAMERICANA" (matches tanto sura eps como sura prepagada) → null (ambiguo)
 */
export function mapToEapbCode(
  canonical: string,
  eapbCodes: EapbCodeForDerivation[],
): EapbMatch | null {
  // Caso especial: PARTICULAR (no depende del catálogo)
  if (canonical.toUpperCase().trim() === 'PARTICULAR') {
    return { code: EAPB_CODE_PARTICULAR, name: 'Particular', type: 'Particular' }
  }

  const normCanonical = stripDiacriticsAndLower(canonical)
  if (normCanonical === '') return null

  // Por cada eapb, ver si ALGUN alias (normalizado) está contenido en canonical
  // Trackeamos por code (set de códigos únicos) para detectar ambigüedad
  //
  // SHORT-ALIAS GUARD: si el alias es muy corto (<=4 chars) y el canonical es
  // mucho más largo (>= 2x), el match es POCO CONFIABLE: típicamente alias
  // como 'sura' matchea 'SURAMERICANA SEG VIDA' (12 chars) pero la realidad
  // puede ser Sura Prepagada vs Sura EPS. Mejor null → Lady clasifica.
  // El criterio "alias corto contra canonical largo es ruidoso" es el mismo
  // principio del null por ambigüedad: cuando el sistema no está seguro,
  // lo dice, no adivina con cara de seguro.
  const matchedDetails = new Map<string, EapbMatch>()
  for (const eapb of eapbCodes) {
    for (const alias of eapb.aliases) {
      const normAlias = stripDiacriticsAndLower(alias)
      if (normAlias.length === 0) continue

      // Short-alias guard
      if (normAlias.length <= 4 && normCanonical.length >= 2 * normAlias.length) {
        continue // este alias es muy corto contra un canonical mucho más largo — no usar
      }

      if (normCanonical.includes(normAlias)) {
        matchedDetails.set(eapb.code, { code: eapb.code, name: eapb.name, type: eapb.type })
        break // siguiente eapb
      }
    }
  }

  if (matchedDetails.size === 0) return null
  if (matchedDetails.size > 1) return null // ambiguo — el null fuerza decisión humana
  return Array.from(matchedDetails.values())[0]
}

/**
 * Cruza el nombre del procedimiento + convenio contra el staging.
 *
 * Orden de preferencia (de más estricto a más laxo):
 *   1) Match exacto procedimiento + match exacto convenio
 *   2) Match prefijo procedimiento + match exacto convenio
 *   3) FALLBACK: match exacto procedimiento (cualquier convenio) — el caller debe
 *      saber que la `tarifa` puede no corresponder al convenio buscado
 *   4) FALLBACK: match prefijo procedimiento (cualquier convenio) — idem
 *   5) null si nada cruza
 *
 * El parámetro `convenioCanonical` puede ser null (caso 'PARTICULAR' u otros donde
 * la cita no tiene aseguradora identificable) — en ese caso saltamos directo a (3).
 *
 * Bug #2 (deuda histórica, ARG-2026-06-23): la versión vieja de esta función
 * recibía solo `(raw, stagingProducts)` e ignoraba el convenio. Resultado: para
 * un procedimiento existente con N entradas en staging (una por convenio), siempre
 * devolvía el PRIMER match. Para Algia con COLPOSCOPIA en 37 entradas (×3.6 de
 * dispersión de precio), Lady obtenía siempre el precio del primer staging,
 * cruzando tarifas entre convenios. Fix arquitectural: incorporar convenioCanonical
 * en el match.
 */
export function matchProcedureToStaging(
  raw: string,
  convenioCanonical: string | null,
  stagingProducts: StagingProductForDerivation[],
): StagingMatch | null {
  const upper = raw.toUpperCase().trim()
  if (upper === '') return null

  const convenioUpper = convenioCanonical?.toUpperCase().trim() ?? null

  // 1) Match procedimiento exacto + convenio exacto (caso ideal)
  if (convenioUpper) {
    for (const p of stagingProducts) {
      if (
        p.producto_nombre.toUpperCase().trim() === upper &&
        p.convenio_nombre.toUpperCase().trim() === convenioUpper
      ) {
        return {
          productoId: p.id,
          productoNombre: p.producto_nombre,
          tarifa: p.tarifa,
          convenioNombre: p.convenio_nombre,
          matchedBy: 'convenio_exact',
        }
      }
    }

    // 2) Match procedimiento prefijo + convenio exacto
    for (const p of stagingProducts) {
      if (
        p.producto_nombre.toUpperCase().trim().startsWith(upper) &&
        p.convenio_nombre.toUpperCase().trim() === convenioUpper
      ) {
        return {
          productoId: p.id,
          productoNombre: p.producto_nombre,
          tarifa: p.tarifa,
          convenioNombre: p.convenio_nombre,
          matchedBy: 'convenio_prefix',
        }
      }
    }
  }

  // 3) FALLBACK: match exacto procedimiento solo (degradación)
  for (const p of stagingProducts) {
    if (p.producto_nombre.toUpperCase().trim() === upper) {
      return {
        productoId: p.id,
        productoNombre: p.producto_nombre,
        tarifa: p.tarifa,
        convenioNombre: p.convenio_nombre,
        matchedBy: 'fallback_exact',
      }
    }
  }

  // 4) FALLBACK: match prefijo procedimiento solo
  for (const p of stagingProducts) {
    if (p.producto_nombre.toUpperCase().trim().startsWith(upper)) {
      return {
        productoId: p.id,
        productoNombre: p.producto_nombre,
        tarifa: p.tarifa,
        convenioNombre: p.convenio_nombre,
        matchedBy: 'fallback_prefix',
      }
    }
  }

  return null
}

/**
 * Deriva el price_source para la UI a partir del matchedBy de staging.
 * Si la tarifa es 0 (sin precio en staging) → 'none', sin importar el match.
 */
export function derivePriceSource(
  matchedBy: StagingMatchSource,
  tarifa: number,
): PriceSource {
  if (tarifa <= 0) return 'none'
  if (matchedBy === 'convenio_exact' || matchedBy === 'convenio_prefix') {
    return 'convenio_match'
  }
  return 'fallback'
}

/**
 * Calcula duración con umbral mínimo:
 *   - Si durations.length >= threshold (default 5): mediana, source='derived'
 *   - Sino: fallback (default 30), source='default'
 *   - Excluye NaN antes de evaluar el umbral.
 */
export function deriveDuration(
  durations: number[],
  options?: { threshold?: number; fallback?: number },
): DurationResult {
  const threshold = options?.threshold ?? DEFAULT_MIN_CITAS_FOR_DURATION
  const fallback = options?.fallback ?? DEFAULT_FALLBACK_DURATION_MINUTES

  // Filtrar NaN antes de evaluar umbral
  const valid = durations.filter((d) => !isNaN(d))
  const sampleSize = valid.length

  if (sampleSize >= threshold) {
    return { value: median(valid), source: 'derived', sampleSize }
  }
  return { value: fallback, source: 'default', sampleSize }
}

/**
 * Orquesta todo el pipeline:
 *   citas → parse → canonicalize → group by (doctor, proc, convenio)
 *   → match procedimiento contra staging
 *   → map convenio canónico a eapb_code
 *   → derive duration con umbral
 *   → arma SuggestionCombo
 */
export function deriveSuggestions(
  input: DerivationInput,
  options?: DerivationOptions,
): DerivationOutput {
  const minCitas = options?.minCitasForDurationMedian ?? DEFAULT_MIN_CITAS_FOR_DURATION
  const fallback = options?.fallbackDurationMinutes ?? DEFAULT_FALLBACK_DURATION_MINUTES

  interface ComboAccumulator {
    doctor_id: string
    doctor_name: string
    procedimiento_canonical: string
    convenio_canonical: string
    convenio_eapb_match: EapbMatch | null
    staging_product_id: string
    suggested_price: number | null
    staging_matched_by: StagingMatchSource
    durations: number[]
    citasCount: number
  }

  const combos = new Map<string, ComboAccumulator>()
  const unparseableProcedimientos = new Set<string>()
  const unparseableConvenios = new Set<string>()
  let totalCitasParseable = 0
  let aseguradoraUnparseable = 0

  for (const cita of input.citas) {
    if (!cita.procedimiento_raw || cita.procedimiento_raw.trim() === '') continue
    if (!cita.aseguradora_raw || cita.aseguradora_raw.trim() === '') continue

    const parsed = parseAseguradora(cita.aseguradora_raw)
    if (!parsed) {
      // Tenía data pero el parser falló (formato inesperado de iSalud)
      // → contar para que sea visible si el formato cambia algún día
      aseguradoraUnparseable++
      continue
    }

    const canonical = canonicalizeConvenio(parsed)
    const eapbMatch = mapToEapbCode(canonical, input.eapbCodes)
    // Bug #2 fix (2026-06-23): pasar canonical para que el match prefiera el
    // staging del CONVENIO correcto, no el primer match por nombre.
    const stagingMatch = matchProcedureToStaging(cita.procedimiento_raw, canonical, input.stagingProducts)

    if (!stagingMatch) {
      unparseableProcedimientos.add(cita.procedimiento_raw)
      continue
    }

    totalCitasParseable++

    if (!eapbMatch) {
      // El convenio se generó pero no auto-clasificó. Sigue siendo una combinación válida
      // (se crea SuggestionCombo con needs_classification=true), pero también lo trackeamos
      // para la lista resumen "convenios sin clasificar" en la UI.
      unparseableConvenios.add(canonical)
    }

    const key = `${cita.doctor_id}|${stagingMatch.productoId}|${canonical}`
    const existing = combos.get(key)
    if (existing) {
      existing.citasCount++
      if (!isNaN(cita.duration_minutes)) existing.durations.push(cita.duration_minutes)
    } else {
      combos.set(key, {
        doctor_id: cita.doctor_id,
        doctor_name: cita.doctor_name,
        procedimiento_canonical: stagingMatch.productoNombre,
        convenio_canonical: canonical,
        convenio_eapb_match: eapbMatch,
        staging_product_id: stagingMatch.productoId,
        suggested_price: stagingMatch.tarifa,
        staging_matched_by: stagingMatch.matchedBy,
        durations: !isNaN(cita.duration_minutes) ? [cita.duration_minutes] : [],
        citasCount: 1,
      })
    }
  }

  // Materializar SuggestionCombo agrupado por doctor
  const suggestions = new Map<string, DoctorSuggestions>()
  let combinationsWithEapbMatch = 0
  let combinationsNeedingClassification = 0

  for (const acc of combos.values()) {
    const durationResult = deriveDuration(acc.durations, { threshold: minCitas, fallback })
    const needsClassification = acc.convenio_eapb_match === null

    const combo: SuggestionCombo = {
      procedimiento_canonical: acc.procedimiento_canonical,
      convenio_canonical: acc.convenio_canonical,
      convenio_eapb_code: acc.convenio_eapb_match?.code ?? null,
      convenio_eapb_type: acc.convenio_eapb_match?.type ?? null,
      staging_product_id: acc.staging_product_id,
      suggested_price: acc.suggested_price,
      price_source: derivePriceSource(acc.staging_matched_by, acc.suggested_price ?? 0),
      duration_minutes: durationResult.value,
      duration_source: durationResult.source,
      citas_count: acc.citasCount,
      citas_with_duration: acc.durations.length,
      needs_classification: needsClassification,
    }

    if (needsClassification) combinationsNeedingClassification++
    else combinationsWithEapbMatch++

    let docSuggs = suggestions.get(acc.doctor_id)
    if (!docSuggs) {
      docSuggs = { doctor_id: acc.doctor_id, doctor_name: acc.doctor_name, combinations: [] }
      suggestions.set(acc.doctor_id, docSuggs)
    }
    docSuggs.combinations.push(combo)
  }

  return {
    suggestions,
    unparseable: {
      procedimientos: Array.from(unparseableProcedimientos),
      convenios: Array.from(unparseableConvenios),
    },
    stats: {
      totalCitasProcessed: input.citas.length,
      totalCitasParseable,
      totalCombinations: combos.size,
      combinationsWithEapbMatch,
      combinationsNeedingClassification,
      aseguradoraUnparseable,
    },
  }
}

// --- Helpers internos ---

/**
 * Normaliza para matching: NFD decompose, strip diacritics, lowercase, trim.
 */
function stripDiacriticsAndLower(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Mediana de un array numérico (NaN ya filtrados por el caller).
 * Para length par: promedio de los 2 centrales redondeado al entero más cercano.
 * Para length impar: el central.
 * Empty: 0 (caller debe haber chequeado length antes).
 */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const n = sorted.length
  if (n % 2 === 1) return sorted[(n - 1) / 2]
  return Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2)
}
