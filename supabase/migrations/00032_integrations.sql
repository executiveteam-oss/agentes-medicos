-- ============================================================
-- Migración: Integrations JSONB + external_his_id
-- Agrega columna de integraciones a clínicas y campo de ID
-- externo del HIS en appointments
-- ============================================================

-- 1. Columna integrations en clinics (JSONB)
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS integrations JSONB DEFAULT '{}';

COMMENT ON COLUMN clinics.integrations IS 'Configuración de integraciones externas (HIS, etc.)';

-- 2. Campo external_his_id en appointments
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS external_his_id TEXT;

COMMENT ON COLUMN appointments.external_his_id IS 'ID de la cita en el sistema de Historia Clínica externo';

-- Índice para buscar citas por external_his_id
CREATE INDEX IF NOT EXISTS idx_appointments_external_his_id
  ON appointments(external_his_id)
  WHERE external_his_id IS NOT NULL;
