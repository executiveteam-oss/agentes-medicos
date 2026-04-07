-- ============================================================
-- Migración 00031: Campos de gestión de glosas
-- Agrega campos detallados para tracking de glosas EPS
-- ============================================================

-- Campos de glosa en appointments (glosa_value y glosa_reason ya existen de 00010)
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS glosa_notification_date DATE,
  ADD COLUMN IF NOT EXISTS glosa_response_date DATE,
  ADD COLUMN IF NOT EXISTS glosa_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS glosa_notes TEXT;

-- Índice para consultas de glosas activas
CREATE INDEX IF NOT EXISTS idx_appointments_glosa_status
  ON appointments(clinic_id, glosa_status)
  WHERE glosa_status != 'none';

-- Comentarios
COMMENT ON COLUMN appointments.glosa_notification_date IS 'Fecha en que la EPS notificó la glosa';
COMMENT ON COLUMN appointments.glosa_response_date IS 'Fecha en que se respondió la glosa';
COMMENT ON COLUMN appointments.glosa_status IS 'none | pending | responded | lifted | definitive';
COMMENT ON COLUMN appointments.glosa_notes IS 'Notas y argumentos de respuesta a la glosa';
