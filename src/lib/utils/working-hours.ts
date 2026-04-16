// ============================================================
// Helpers para working_hours (horarios de doctor/clínica)
//
// Soporta dos formatos:
// - Viejo: { monday: { start: "08:00", end: "17:00", active: true } }
// - Nuevo: { monday: { active: true, blocks: [{start, end}, ...] } }
//
// Toda lectura de working_hours debe pasar por `normalizeWorkingHours()`
// para obtener uniformemente el formato con `blocks[]`.
// ============================================================

import type {
  WorkingDay,
  WorkingHours,
  WorkingBlock,
  NormalizedWorkingDay,
  NormalizedWorkingHours,
} from '@/types/database'

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const satisfies ReadonlyArray<keyof WorkingHours>

/**
 * Normaliza un día. Si viene en formato viejo, lo convierte a `{active, blocks: [{start, end}]}`.
 * Si ya viene con `blocks`, los respeta.
 * Si no tiene ni blocks ni start/end válidos, retorna `{active: false, blocks: []}`.
 */
export function normalizeWorkingDay(day: WorkingDay | null | undefined): NormalizedWorkingDay {
  if (!day) return { active: false, blocks: [] }

  const active = day.active === true

  // Caso 1: ya tiene blocks (formato nuevo)
  if (Array.isArray(day.blocks)) {
    const blocks = day.blocks
      .filter((b): b is WorkingBlock => !!b && typeof b.start === 'string' && typeof b.end === 'string')
      .map((b) => ({ start: b.start, end: b.end }))
    return { active, blocks }
  }

  // Caso 2: formato viejo {start, end}
  if (typeof day.start === 'string' && typeof day.end === 'string') {
    return { active, blocks: [{ start: day.start, end: day.end }] }
  }

  // Caso 3: día sin info de horario
  return { active, blocks: [] }
}

/**
 * Normaliza el objeto completo de working_hours a `Record<dia, NormalizedWorkingDay>`.
 * Acepta el JSONB tal cual viene de Supabase (puede traer cualquiera de los dos formatos).
 */
export function normalizeWorkingHours(
  wh: WorkingHours | Record<string, unknown> | null | undefined
): NormalizedWorkingHours {
  const result = {} as NormalizedWorkingHours
  for (const key of DAY_KEYS) {
    const raw = (wh as Record<string, unknown> | null | undefined)?.[key] as WorkingDay | undefined
    result[key] = normalizeWorkingDay(raw)
  }
  return result
}

/**
 * Convierte "HH:MM" a minutos desde medianoche.
 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Suma minutos de atención de un día (sumando todos los bloques).
 */
export function dayTotalMinutes(day: NormalizedWorkingDay): number {
  if (!day.active) return 0
  return day.blocks.reduce((sum, b) => sum + Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start)), 0)
}

/**
 * ¿Dos bloques se solapan? (mismo día)
 */
export function blocksOverlap(a: WorkingBlock, b: WorkingBlock): boolean {
  const aStart = timeToMinutes(a.start)
  const aEnd = timeToMinutes(a.end)
  const bStart = timeToMinutes(b.start)
  const bEnd = timeToMinutes(b.end)
  return aStart < bEnd && bStart < aEnd
}

/**
 * Valida la lista de bloques de un día. Retorna mensaje de error o null si todo está bien.
 */
export function validateBlocks(blocks: WorkingBlock[]): string | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (!b.start || !b.end) return 'Hora inválida'
    if (timeToMinutes(b.start) >= timeToMinutes(b.end)) return 'La hora de inicio debe ser menor que la de fin'
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocksOverlap(b, blocks[j])) return 'Los bloques no pueden solaparse'
    }
  }
  return null
}

/**
 * Default para días sin configuración (ej. al activar un día por primera vez).
 */
export function defaultBlock(): WorkingBlock {
  return { start: '08:00', end: '17:00' }
}

export const WORKING_HOURS_DAY_KEYS = DAY_KEYS
