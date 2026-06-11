// ============================================================
// Lógica pura del campo attendance_outcome (migración 00073).
//
// Modelo según columna FASE del export iSalud:
//   NULL          = Programado (estado inicial)
//   'admitido'    = paciente llegó y se admitió
//   'facturado'   = consulta facturada
//   'inasistente' = paciente no se presentó
//
// Función pura testeable sin DB.
// ============================================================

import type { AttendanceOutcome } from '@/types/database'

/**
 * Calcula el delta a aplicar a patient.no_show_count cuando una cita
 * transiciona de un estado de asistencia a otro.
 *
 * Regla simple:
 *   - Si entra en 'inasistente' desde NO-inasistente → +1
 *   - Si sale de 'inasistente' hacia NO-inasistente → -1
 *   - Cualquier otra transición → 0
 *   - Idempotencia: previous === next → 0
 */
export function computeNoShowDelta(
  previous: AttendanceOutcome | null,
  next: AttendanceOutcome | null,
): -1 | 0 | 1 {
  if (previous === next) return 0
  if (previous !== 'inasistente' && next === 'inasistente') return 1
  if (previous === 'inasistente' && next !== 'inasistente') return -1
  return 0
}

/** Label en español (UI) para cada estado, incluyendo NULL = "Programado" */
export function attendanceOutcomeLabel(o: AttendanceOutcome | null): string {
  switch (o) {
    case 'admitido': return 'Admitido'
    case 'facturado': return 'Facturado'
    case 'inasistente': return 'Inasistente'
    case null: return 'Programado'
  }
}
