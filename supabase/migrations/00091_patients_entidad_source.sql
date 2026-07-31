-- ============================================================
-- entidad con FUENTE y FECHA. La entidad la declara la paciente en la
-- conversación de aquí en adelante, y lo declarado le gana a lo scrapeado.
-- Precedencia: 'paciente'/'secretaria' > 'isalud' (el derive de iSalud NUNCA
-- pisa una fuente humana).
-- ============================================================

ALTER TABLE patients RENAME COLUMN entidad_isalud TO entidad;

ALTER TABLE patients ADD COLUMN IF NOT EXISTS entidad_source text
  CHECK (entidad_source IN ('isalud', 'paciente', 'secretaria'));
ALTER TABLE patients ADD COLUMN IF NOT EXISTS entidad_updated_at timestamptz;

-- Backfill: lo que ya está vino del histórico iSalud.
UPDATE patients
SET entidad_source = 'isalud', entidad_updated_at = now()
WHERE entidad IS NOT NULL AND entidad_source IS NULL;
