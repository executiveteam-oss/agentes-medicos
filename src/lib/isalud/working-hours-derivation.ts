// ============================================================
// Working Hours Derivation — pure logic, no DB, no I/O
//
// ⚠ NO ESTÁ EN USO PRODUCTIVO (2026-06-10)
//
// Este módulo se construyó para alimentar el importador one-shot
// `scripts/import-isalud-working-hours.ts`, pero el diagnóstico
// reveló que iSalud NO tiene una fuente limpia del horario laboral:
//   - /disponibilidad subestima (muestra solo slots configurados
//     para agendamiento web, no la jornada completa del médico).
//   - Las citas históricas también subestiman desde el ángulo
//     opuesto (un médico que atiende 8–18 puede tener primera cita
//     a las 9 y última a las 16).
//
// Caso concreto: JOSÉ DUVÁN tiene 243 citas reales 07–16 en miércoles
// y jueves, pero /disponibilidad solo capturaba 07–11 → con esa fuente
// se hubieran perdido ~121 citas.
//
// Decisión: los working_hours en Omuwan se configuran MANUALMENTE
// desde el dashboard. Ningún auto-populate desde iSalud.
//
// Por qué este módulo queda en el repo (no se borra):
//   - Lógica pura, testeada (26 tests verdes)
//   - Útil a futuro si decidimos sugerir horarios DESDE LAS CITAS
//     YA ACUMULADAS EN OMUWAN (no iSalud) como ayuda opcional
//   - El cambio sería trivial: misma lógica, distinta fuente
//
// Detalle del diagnóstico: ver sesión 2026-06-10 en CLAUDE.md.
//
// --- Si en el futuro alguien decide usar esto en producción ---
//
// Política de confianza:
// - 'high': >= minDatesPerWeekday fechas distintas con slots ese día
// - 'low':  entre 1 y (threshold - 1)
// - 'none': sin slots
//
// Política del script consumidor (vigente cuando se usó):
//   - 'high' → poblar derivado
//   - 'none' → inactivar (ausencia es evidencia)
//   - 'low'  → preservar default, revisión manual
// ============================================================

import type { WorkingBlock } from '@/types/database'
import type { ISaludDisponibilidadSlot } from './adapter'
import { normalizeWorkingHours } from '@/lib/utils/working-hours'

// --- Tipos ---

export type WeekdayKey =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'

export type Confidence = 'high' | 'low' | 'none'

export interface DerivedDay {
  active: boolean
  blocks: WorkingBlock[]
  confidence: Confidence
  sourceDatesCount: number
}

export interface DerivationResult {
  derived: Record<WeekdayKey, DerivedDay>
  totalSlots: number
  dateRange: { from: string; to: string } | null
}

export interface DerivationOptions {
  minDatesPerWeekday?: number // default 2
  lunchGapMinutes?: number    // default 60
}

// --- Constantes ---

export const WEEKDAY_BY_DOW: Record<number, WeekdayKey> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
}

export const ALL_WEEKDAYS: ReadonlyArray<WeekdayKey> = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

const DEFAULT_OPTIONS: Required<DerivationOptions> = {
  minDatesPerWeekday: 2,
  lunchGapMinutes: 60,
}

// --- API pública ---

/**
 * Deriva el patrón semanal de working_hours desde los slots de iSalud.
 * Pura. Sin DB. Sin red.
 *
 * Algoritmo por weekday:
 *   1. Bucket por weekday
 *   2. Agrupar por fecha → blocks por fecha (con merge intra-día por lunchGap)
 *   3. Hashear blocks y elegir el patrón modal
 *   4. Confidence = 'high' si #fechas >= threshold, 'low' si < threshold pero > 0, 'none' si 0
 */
export function deriveWeeklyPattern(
  slots: ISaludDisponibilidadSlot[],
  options?: DerivationOptions,
): DerivationResult {
  const opts: Required<DerivationOptions> = {
    minDatesPerWeekday: options?.minDatesPerWeekday ?? DEFAULT_OPTIONS.minDatesPerWeekday,
    lunchGapMinutes: options?.lunchGapMinutes ?? DEFAULT_OPTIONS.lunchGapMinutes,
  }

  // 1. Descartar slots inválidos: hora_inicio >= hora_fin
  const validSlots = slots.filter(
    (s) => timeToMinutes(s.hora_inicio) < timeToMinutes(s.hora_fin),
  )

  // 2. Date range (sobre slots válidos)
  let dateRange: { from: string; to: string } | null = null
  if (validSlots.length > 0) {
    const fechas = validSlots.map((s) => s.fecha)
    dateRange = { from: fechas.reduce((a, b) => (a < b ? a : b)), to: fechas.reduce((a, b) => (a > b ? a : b)) }
  }

  // 3. Inicializar resultado vacío para los 7 días
  const derived = {} as Record<WeekdayKey, DerivedDay>
  for (const day of ALL_WEEKDAYS) {
    derived[day] = { active: false, blocks: [], confidence: 'none', sourceDatesCount: 0 }
  }

  // 4. Por cada weekday (0-6), derivar el patrón
  for (let dow = 0; dow < 7; dow++) {
    const weekdayKey = WEEKDAY_BY_DOW[dow]
    const slotsThisDay = validSlots.filter((s) => s.dia_semana === dow)
    if (slotsThisDay.length === 0) continue // queda en {active:false, blocks:[], confidence:'none', sourceDatesCount:0}

    // 4a. Agrupar por fecha
    const byFecha = new Map<string, Array<{ start: string; end: string }>>()
    for (const s of slotsThisDay) {
      const arr = byFecha.get(s.fecha) ?? []
      arr.push({ start: s.hora_inicio, end: s.hora_fin })
      byFecha.set(s.fecha, arr)
    }

    // 4b. Por cada fecha, consolidar en blocks (merge intra-día por lunchGap)
    const blocksByFecha = new Map<string, WorkingBlock[]>()
    for (const [fecha, intervals] of byFecha.entries()) {
      blocksByFecha.set(fecha, consolidateDayBlocks(intervals, opts.lunchGapMinutes))
    }

    // 4c. Hashear y contar frecuencias, llevando track de la fecha más reciente por hash
    const hashCounts = new Map<string, { count: number; mostRecentDate: string; blocks: WorkingBlock[] }>()
    for (const [fecha, blocks] of blocksByFecha.entries()) {
      const h = hashBlocks(blocks)
      const existing = hashCounts.get(h)
      if (existing) {
        existing.count++
        if (fecha > existing.mostRecentDate) existing.mostRecentDate = fecha
      } else {
        hashCounts.set(h, { count: 1, mostRecentDate: fecha, blocks })
      }
    }

    // 4d. Elegir el hash ganador: mayor count, ties → fecha más reciente
    let winner: { count: number; mostRecentDate: string; blocks: WorkingBlock[] } | undefined
    for (const entry of hashCounts.values()) {
      if (!winner) {
        winner = entry
      } else if (entry.count > winner.count) {
        winner = entry
      } else if (entry.count === winner.count && entry.mostRecentDate > winner.mostRecentDate) {
        winner = entry
      }
    }

    // 4e. Construir DerivedDay
    const sourceDatesCount = byFecha.size
    const confidence: Confidence = sourceDatesCount >= opts.minDatesPerWeekday ? 'high' : 'low'
    derived[weekdayKey] = {
      active: true,
      blocks: winner ? winner.blocks : [],
      confidence,
      sourceDatesCount,
    }
  }

  return { derived, totalSlots: validSlots.length, dateRange }
}

/**
 * Consolida intervals de UN solo día en una lista de blocks:
 *   - Sort por start
 *   - Merge si gap (next.start - prev.end) < lunchGapMinutes
 *   - Solapamientos cuentan como gap negativo → merge
 *   - Cuando merge, end = max(prev.end, next.end)
 */
function consolidateDayBlocks(
  intervals: Array<{ start: string; end: string }>,
  lunchGapMinutes: number,
): WorkingBlock[] {
  if (intervals.length === 0) return []

  const sorted = intervals.slice().sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
  const out: WorkingBlock[] = []
  let current: WorkingBlock = { start: sorted[0].start, end: sorted[0].end }

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    const gap = timeToMinutes(next.start) - timeToMinutes(current.end)
    if (gap < lunchGapMinutes) {
      // Merge: extender current.end al máximo
      if (timeToMinutes(next.end) > timeToMinutes(current.end)) current.end = next.end
    } else {
      out.push(current)
      current = { start: next.start, end: next.end }
    }
  }
  out.push(current)
  return out
}

/**
 * ¿working_hours es exactamente el default de `buildDefaultWorkingHours`?
 * Comparación bit-exact tras normalizar (acepta variantes históricas como
 * sunday.blocks=[] o sunday.blocks=[{00:00, 00:00}]).
 *
 * - sunday: active=false (blocks irrelevantes mientras active=false)
 * - mon-fri: active=true, exactamente 1 block 08:00-18:00
 * - saturday: active=true, exactamente 1 block 08:00-13:00
 *
 * Cualquier desviación → false (no tocar).
 */
export function isDefaultWorkingHours(wh: unknown): boolean {
  // Defensa: si no es un objeto, no puede ser el default
  if (!wh || typeof wh !== 'object') return false

  // S2.8: incompleto (faltan días) — normalizeWorkingHours fillea con {active:false, blocks:[]},
  // así que detectamos por chequeo explícito de presencia en el input crudo.
  const raw = wh as Record<string, unknown>
  for (const day of ALL_WEEKDAYS) {
    if (!(day in raw)) return false
  }

  const normalized = normalizeWorkingHours(raw)

  // Sunday: debe estar inactivo (blocks irrelevantes mientras active=false)
  if (normalized.sunday.active !== false) return false

  // Mon-Fri: active=true, exactamente 1 block 08:00-18:00
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const) {
    const d = normalized[day]
    if (d.active !== true) return false
    if (d.blocks.length !== 1) return false
    if (d.blocks[0].start !== '08:00' || d.blocks[0].end !== '18:00') return false
  }

  // Saturday: active=true, exactamente 1 block 08:00-13:00
  const sat = normalized.saturday
  if (sat.active !== true) return false
  if (sat.blocks.length !== 1) return false
  if (sat.blocks[0].start !== '08:00' || sat.blocks[0].end !== '13:00') return false

  return true
}

// --- Helpers internos (exportados solo para tests específicos) ---

/**
 * Convierte "HH:MM" a minutos desde medianoche.
 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Hash canónico de una lista de blocks ordenados:
 *   [{08:00,12:00}, {14:00,18:00}]  →  "08:00-12:00|14:00-18:00"
 *   []                              →  "INACTIVE"
 */
export function hashBlocks(blocks: WorkingBlock[]): string {
  if (blocks.length === 0) return 'INACTIVE'
  return blocks
    .slice()
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
    .map((b) => `${b.start}-${b.end}`)
    .join('|')
}
