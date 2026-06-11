-- ============================================================
-- 00073_attendance_outcome.sql
--
-- Agrega attendance_outcome como campo SEPARADO de status.
-- Modela los valores que iSalud usa en su columna FASE:
--   NULL          = Programado (cita sin marcar, estado inicial)
--   'admitido'    = paciente llegó y se admitió
--   'facturado'   = consulta facturada
--   'inasistente' = no se presentó
--
-- 'Alta administrativa' (1 caso raro en iSalud) queda FUERA del enum.
--
-- Backfill desde campo legacy 'status':
--   status='completed' → 'facturado'  (201 filas)
--   status='no_show'   → 'inasistente' (76 filas)
--
-- El campo legacy 'status' NO se modifica — las filas viejas mantienen
-- ambos campos poblados durante la transición. Rollback = DROP COLUMN.
--
-- Aplicada en producción: 2026-06-11
-- Backfill verificado side-by-side contra status legacy: 100% match en
-- 5 semanas con data real (abril-mayo 2026) — 110 facturadas + 25
-- inasistentes coincidieron exactamente con counts legacy.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN attendance_outcome TEXT;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_attendance_outcome_check
  CHECK (attendance_outcome IS NULL
         OR attendance_outcome IN ('admitido', 'facturado', 'inasistente'));

UPDATE appointments
SET attendance_outcome = 'facturado'
WHERE status = 'completed'
  AND attendance_outcome IS NULL;

UPDATE appointments
SET attendance_outcome = 'inasistente'
WHERE status = 'no_show'
  AND attendance_outcome IS NULL;

CREATE INDEX idx_appointments_attendance_outcome
  ON appointments(clinic_id, attendance_outcome)
  WHERE attendance_outcome IS NOT NULL;

COMMENT ON COLUMN appointments.attendance_outcome IS
  'Resultado de asistencia del día (eje separado de status). NULL = Programado (estado inicial). Valores: admitido | facturado | inasistente. Modelado según columna FASE del export iSalud.';
