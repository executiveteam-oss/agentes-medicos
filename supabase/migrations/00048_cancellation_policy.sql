-- Migración 00048: Política de cancelación configurable por clínica
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS cancellation_policy TEXT;
