-- ============================================================
-- Migración 00028: Flujo de documentos requeridos para citas
-- Permite marcar citas que requieren documentos previos
-- (historia clínica, orden médica, etc.)
-- ============================================================

-- Campos en appointments para rastrear documentos
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS documents_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS documents_received BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS documents_received_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS documents_notes TEXT;

-- Índice para consultas de documentos pendientes
CREATE INDEX IF NOT EXISTS idx_appointments_docs_pending
  ON appointments(documents_requested, documents_received, starts_at)
  WHERE documents_requested = true AND documents_received = false;
