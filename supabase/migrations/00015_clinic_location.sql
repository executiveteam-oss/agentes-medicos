-- ============================================================
-- Campos de ubicación detallada del consultorio
-- Para la confirmación de citas por WhatsApp
-- ============================================================

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS building TEXT,
  ADD COLUMN IF NOT EXISTS floor TEXT,
  ADD COLUMN IF NOT EXISTS office TEXT;
