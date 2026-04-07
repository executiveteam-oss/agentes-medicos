-- ============================================================
-- Migración: Soporte para consultas virtuales
-- Agrega modalidad a tipos de consulta y citas,
-- link de videollamada, y configuración por clínica
-- ============================================================

-- 1. Modalidad en tipos de consulta
ALTER TABLE consultation_types
  ADD COLUMN IF NOT EXISTS modality TEXT NOT NULL DEFAULT 'presencial'
  CHECK (modality IN ('presencial', 'virtual', 'ambas'));

-- 2. Campos de cita virtual
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS modality TEXT NOT NULL DEFAULT 'presencial'
  CHECK (modality IN ('presencial', 'virtual'));

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS virtual_link TEXT;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS virtual_link_sent_at TIMESTAMPTZ;

-- 3. Configuración de consultas virtuales por clínica
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS virtual_config JSONB DEFAULT '{"enabled": false, "platform": "custom", "base_url": null, "instructions": null}';

-- 4. Índice para el cron de envío de links virtuales
CREATE INDEX IF NOT EXISTS idx_appointments_virtual_pending
  ON appointments(modality, starts_at)
  WHERE modality = 'virtual' AND virtual_link IS NOT NULL AND virtual_link_sent_at IS NULL;
