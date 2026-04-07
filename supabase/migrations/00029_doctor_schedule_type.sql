-- ============================================================
-- Migración 00029: Tipo de horario por doctor (fijo vs manual)
-- Doctores con schedule_type = 'manual' no tienen agenda fija,
-- las solicitudes de cita se gestionan como lista de espera.
-- ============================================================

-- Tipo de horario en doctors
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS schedule_type TEXT NOT NULL DEFAULT 'fixed' CHECK (schedule_type IN ('fixed', 'manual'));
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS manual_availability_message TEXT;

-- Campos adicionales en waitlist para solicitudes manuales
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS preferred_schedule_notes TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'dashboard' CHECK (source IN ('dashboard', 'whatsapp'));
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS consultation_type_name TEXT;

-- Índice para solicitudes manuales pendientes
CREATE INDEX IF NOT EXISTS idx_waitlist_pending_manual
  ON waitlist(clinic_id, status, source)
  WHERE status = 'waiting' AND source = 'whatsapp';
