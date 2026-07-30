// ============================================================
// Validación pura de horario: ¿la hora de inicio cae dentro del working_hours
// del médico? Usada por el GUARD de create_appointment (camino del AGENTE).
//
// NO usa fallback al horario de la clínica: un día explícitamente inactivo del
// médico = FUERA de horario. (El fallback a clínica de check_availability es
// otro tema, aparte.)
// ============================================================
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
 * ¿La hora "HH:MM" de inicio cae dentro de alguna franja del día?
 * Fin EXCLUSIVO: empezar exactamente al cierre de la franja = FUERA.
 */
export function isStartWithinSchedule(startHHMM: string, day: DaySchedule): boolean {
  if (!day.active || day.blocks.length === 0) return false
  const t = hhmmToMin(startHHMM)
  return day.blocks.some((b) => t >= hhmmToMin(b.start) && t < hhmmToMin(b.end))
}
