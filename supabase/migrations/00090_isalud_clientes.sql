-- ============================================================
-- MIGRACIÓN ALGIA (un solo uso) — clientes iSalud como tabla de REFERENCIA.
-- NO son pacientes de Omuwan (consentimiento nulo). Fuente de consulta: cuando
-- una de estas personas escribe y se identifica, se promueve a patients con su
-- entidad + tratante ya derivados del histórico. Rescata los ~15K teléfonos que
-- hoy viven solo en un archivo local. Solo 3 campos (lo que trae /cliente).
-- ============================================================

CREATE TABLE IF NOT EXISTS isalud_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  documento text NOT NULL,
  nombre text,
  telefono text,
  loaded_at timestamptz DEFAULT now(),
  UNIQUE (clinic_id, documento)
);
CREATE INDEX IF NOT EXISTS idx_isalud_clientes_doc ON isalud_clientes(clinic_id, documento);

ALTER TABLE isalud_clientes ENABLE ROW LEVEL SECURITY;
