-- ============================================================
-- Migración 00030: Frecuencia de visita por paciente
-- Permite reactivación basada en frecuencia individual
-- ============================================================

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS visit_frequency_days INTEGER;

COMMENT ON COLUMN patients.visit_frequency_days IS 'Promedio de días entre visitas consecutivas. NULL si <2 citas completadas.';
