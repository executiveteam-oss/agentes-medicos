// ============================================================
// ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
//
// Match de nombres entre clientes iSalud y appointments.reason
// de Omuwan. Lógica pura — cero side effects, cero DB, cero red.
//
// Estructura de 3 niveles:
//   1. canonize(name) — normalización del string (uppercase, sin
//      diacríticos, sin caracteres no-letra, collapse whitespace)
//   2. tokenize(canon) — split + separar partículas (DE, LA, etc.)
//   3. matchNames(iSalud, appt) — decide tipo de match con confidence
//
// Análisis del set Algia (validado 2026-06-15):
//   - 100% all-caps, 10% con tildes, 58% con espacios dobles
//   - 0 colisiones internas al canonizar 592 nombres distintos
// ============================================================

const PARTICULAS = new Set([
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'SAN', 'SANTA',
])

export type NameMatchType =
  | 'exact'             // canon idéntico (con o sin partículas)
  | 'subset_strict'     // subsequence + primer y último token coinciden
  | 'subset_loose'      // subsequence pero algún extremo difiere
  | 'partial_first_last' // extremos coinciden pero tokens internos no son subseq
  | 'no_match'

export interface NameMatch {
  type: NameMatchType
  confidence: number  // 0 a 1
}

export interface TokenizedName {
  full: string[]         // todos los tokens incluyendo partículas
  sustantivos: string[]  // solo tokens sin partículas
}

/**
 * Limpia un nombre para comparación canónica:
 *   - Normaliza Unicode NFD y borra diacríticos (É → E, Ñ → N)
 *   - toUpperCase
 *   - Reemplaza caracteres no-letra por espacio (guiones, comas, puntos)
 *   - Collapse whitespace (espacios dobles, tabs)
 *   - Trim
 */
export function canonize(name: string): string {
  if (!name) return ''
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // borra combining marks (tildes, eñes)
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')        // todo lo no-letra → espacio
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim()
}

/**
 * Separa un canon en tokens y distingue partículas (DE, LA, etc.)
 * de sustantivos (nombres y apellidos).
 */
export function tokenize(canon: string): TokenizedName {
  const full = canon.split(' ').filter((t) => t.length > 0)
  const sustantivos = full.filter((t) => !PARTICULAS.has(t))
  return { full, sustantivos }
}

/**
 * Verifica si `short` aparece como subsequence dentro de `long`,
 * preservando orden pero permitiendo gaps.
 *   ["MARIA","GARCIA"] dentro de ["MARIA","ALEJANDRA","GARCIA"] → true
 *   ["GARCIA","MARIA"] dentro de ["MARIA","ALEJANDRA","GARCIA"] → false (orden)
 */
function isSubsequence(short: string[], long: string[]): boolean {
  if (short.length === 0) return false
  let j = 0
  for (const tok of short) {
    while (j < long.length && long[j] !== tok) j++
    if (j === long.length) return false
    j++
  }
  return true
}

/**
 * Decide el tipo de match entre dos nombres.
 *
 * Reglas (en orden de precedencia):
 *   1. exact      — canon idéntico (confidence 1.0)
 *   2. exact      — sustantivos idénticos (ignora partículas) (confidence 0.99)
 *   3. subset_strict — subsequence + primer y último token coinciden (0.95)
 *   4. subset_loose  — subsequence pero algún extremo difiere (0.75)
 *   5. partial_first_last — solo extremos coinciden (0.60)
 *   6. no_match (0)
 *
 * Sólo nombres con >= 2 tokens sustantivos pueden ser considerados
 * para match parcial. Un solo token es muy débil para auto-decidir.
 */
export function matchNames(iSalud: string, appt: string): NameMatch {
  const cI = canonize(iSalud)
  const cA = canonize(appt)

  if (!cI || !cA) return { type: 'no_match', confidence: 0 }

  // 1. Exact canon match (incluye partículas idénticas)
  if (cI === cA) return { type: 'exact', confidence: 1.0 }

  const tI = tokenize(cI).sustantivos
  const tA = tokenize(cA).sustantivos

  if (tI.length === 0 || tA.length === 0) {
    return { type: 'no_match', confidence: 0 }
  }

  // 2. Exact ignorando partículas
  // ("MARIA DE LA CRUZ" vs "MARIA CRUZ" — misma persona, partículas distintas)
  if (tI.join(' ') === tA.join(' ')) {
    return { type: 'exact', confidence: 0.99 }
  }

  const [shorter, longer] = tA.length <= tI.length ? [tA, tI] : [tI, tA]

  // Necesita >= 2 tokens para auto-match parcial
  if (shorter.length < 2) return { type: 'no_match', confidence: 0 }

  const firstMatch = shorter[0] === longer[0]
  const lastMatch = shorter[shorter.length - 1] === longer[longer.length - 1]
  const subseq = isSubsequence(shorter, longer)

  // 3. Subset strict: subsequence + extremos coinciden
  //    Cubre el caso "MARIA GARCIA PEREZ" vs "MARIA ALEJANDRA GARCIA PEREZ"
  //    (segundo nombre extra en iSalud, apellido paterno/materno idénticos)
  if (firstMatch && lastMatch && subseq) {
    return { type: 'subset_strict', confidence: 0.95 }
  }

  // 4. Subset loose: subsequence pero algún extremo distinto
  //    Riesgoso: apellido paterno cambiado, podría ser otra persona
  if (subseq) {
    return { type: 'subset_loose', confidence: 0.75 }
  }

  // 5. Partial first+last: extremos coinciden, tokens internos no son subseq
  //    Muy ambiguo, sólo para revisión humana
  if (firstMatch && lastMatch) {
    return { type: 'partial_first_last', confidence: 0.60 }
  }

  return { type: 'no_match', confidence: 0 }
}

/**
 * Helper para indexar una lista de nombres por su primer token canonizado.
 * Reduce el costo de buscar candidatos en N nombres de O(N) a O(N/buckets).
 *
 * NOTA: indexa también por segundo token para cubrir casos donde el
 *       primer token es ambiguo (Cliente iSalud "JOSE JUAN" vs appt "JUAN GARCIA").
 *       Buscar candidatos requiere unir ambos índices.
 */
export function indexByFirstAndSecondToken(names: string[]): {
  byFirst: Map<string, string[]>
  bySecond: Map<string, string[]>
} {
  const byFirst = new Map<string, string[]>()
  const bySecond = new Map<string, string[]>()

  for (const name of names) {
    const sustantivos = tokenize(canonize(name)).sustantivos
    if (sustantivos[0]) {
      if (!byFirst.has(sustantivos[0])) byFirst.set(sustantivos[0], [])
      byFirst.get(sustantivos[0])!.push(name)
    }
    if (sustantivos[1]) {
      if (!bySecond.has(sustantivos[1])) bySecond.set(sustantivos[1], [])
      bySecond.get(sustantivos[1])!.push(name)
    }
  }

  return { byFirst, bySecond }
}

/**
 * Busca candidatos a match para un nombre dado, usando el índice.
 * Devuelve un set unificado (sin duplicados) de nombres a evaluar.
 */
export function findCandidates(
  name: string,
  index: { byFirst: Map<string, string[]>; bySecond: Map<string, string[]> },
): string[] {
  const sustantivos = tokenize(canonize(name)).sustantivos
  if (sustantivos.length === 0) return []

  const candidates = new Set<string>()
  // Buscar por primer token del input contra primeros e segundos tokens del índice
  for (const t of sustantivos.slice(0, 2)) {
    for (const n of index.byFirst.get(t) ?? []) candidates.add(n)
    for (const n of index.bySecond.get(t) ?? []) candidates.add(n)
  }
  return Array.from(candidates)
}
