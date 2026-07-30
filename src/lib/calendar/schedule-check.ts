// ============================================================
// "El executor valida fechas" — helpers PUROS del backstop de create/cancel/
// reschedule (camino del AGENTE). Dos ejes:
//   - ¿el inicio es FUTURO?                       → isFutureStart
//   - ¿la cita cabe COMPLETA en una franja?        → isRangeWithinSchedule
//
// NO hay fallback al horario de la clínica: un día explícitamente inactivo del
// médico = FUERA de horario. (El fallback a clínica de check_availability es
// otro tema, aparte.)
// ============================================================
import { parseISO, isValid } from 'date-fns'
import { normalizeWorkingHours } from '@/lib/utils/working-hours'
import type { WorkingBlock } from '@/types/database'

export interface DaySchedule { active: boolean; blocks: WorkingBlock[] }

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
export type DayKey = (typeof DAY_KEYS)[number]

/** Día de la semana (0=domingo..6=sábado, como Date.getDay()) → clave del working_hours. */
export function dayKeyFromIndex(dayIndex: number): DayKey {
  return DAY_KEYS[dayIndex] ?? 'sunday'
}

/** Bloques del día para un médico. Sin working_hours o día ausente → inactivo. */
export function getDoctorDaySchedule(workingHours: unknown | null, dayKey: string): DaySchedule {
  if (!workingHours) return { active: false, blocks: [] }
  const wh = normalizeWorkingHours(workingHours as Record<string, unknown>) as unknown as Record<string, { active?: boolean; blocks?: WorkingBlock[] } | undefined>
  const day = wh[dayKey]
  if (!day) return { active: false, blocks: [] }
  return { active: !!day.active, blocks: Array.isArray(day.blocks) ? day.blocks : [] }
}

function hhmmToMin(s: string): number {
  const parts = s.split(':')
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1] ?? '0', 10)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/**
 * Une franjas contiguas o solapadas en bloques maximales. Contiguas = una
 * termina donde arranca la otra (11:45→13:15 NO, pero 12:00→12:00 SÍ). Así una
 * cita que cruza el borde entre dos franjas pegadas no se rechaza. Devuelve
 * intervalos [start,end] en minutos, ordenados.
 */
function mergedIntervals(blocks: WorkingBlock[]): Array<{ start: number; end: number }> {
  const iv = blocks
    .map((b) => ({ start: hhmmToMin(b.start), end: hhmmToMin(b.end) }))
    .filter((x) => x.end > x.start)
    .sort((a, b) => a.start - b.start)
  const out: Array<{ start: number; end: number }> = []
  for (const cur of iv) {
    const last = out[out.length - 1]
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/**
 * ¿La cita [startHHMM, endHHMM) cabe COMPLETA en una sola franja del día
 * (tras unir franjas contiguas)? Inicio y fin dentro del MISMO bloque. Fin del
 * bloque INCLUSIVO: la cita puede terminar exactamente al cierre de la franja.
 */
export function isRangeWithinSchedule(startHHMM: string, endHHMM: string, day: DaySchedule): boolean {
  if (!day.active || day.blocks.length === 0) return false
  const start = hhmmToMin(startHHMM)
  const end = hhmmToMin(endHHMM)
  if (end <= start) return false
  return mergedIntervals(day.blocks).some((b) => start >= b.start && end <= b.end)
}

/** ¿El instante de inicio (ISO 8601, como viene de la DB) es estrictamente
 *  futuro respecto a `now`? Fecha inválida → false (defensivo). */
export function isFutureStart(startsAtIso: string, now: Date): boolean {
  const d = parseISO(startsAtIso)
  if (!isValid(d)) return false
  return d.getTime() > now.getTime()
}
