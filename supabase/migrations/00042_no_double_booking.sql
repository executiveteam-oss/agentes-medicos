-- Migración 00042: Prevenir double-booking a nivel de DB
-- Evita race conditions cuando dos pacientes intentan agendar el mismo slot
-- Solo aplica a citas activas (confirmed o rescheduled)

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_no_double_booking
  ON appointments (doctor_id, starts_at)
  WHERE status IN ('confirmed', 'rescheduled');
