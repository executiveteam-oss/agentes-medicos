-- ============================================================
-- Migración 00020: Columnas para automatizaciones
-- Post-consulta: followup_sent, nps_score en appointments
-- Reactivación: last_reactivation_sent en patients
-- ============================================================

-- Appointments: seguimiento post-consulta
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS followup_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nps_score INTEGER;

-- Patients: reactivación de inactivos
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS last_reactivation_sent DATE;

-- Índice para el cron de post-consulta:
-- busca appointments completadas sin followup
CREATE INDEX IF NOT EXISTS idx_appointments_followup
  ON appointments(clinic_id, status, followup_sent)
  WHERE status = 'completed' AND followup_sent = false;

-- Índice para el cron de reactivación:
-- busca pacientes con múltiples citas sin reactivación reciente
CREATE INDEX IF NOT EXISTS idx_patients_reactivation
  ON patients(clinic_id, last_reactivation_sent)
  WHERE total_appointments >= 2;
