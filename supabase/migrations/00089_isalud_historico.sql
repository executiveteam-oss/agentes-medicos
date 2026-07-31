-- ============================================================
-- MIGRACIÓN ALGIA (un solo uso) — histórico iSalud
-- Filas crudas del histórico + checkpoint de scrape + derivados en patients.
-- entidad_isalud = texto crudo (NO es EPS; iSalud mezcla EPS/prepagada/póliza/
-- particular). NO tocar patients.eps (alimenta Res-256).
-- ============================================================

CREATE TABLE IF NOT EXISTS isalud_historico_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  isalud_agenda_id bigint NOT NULL,
  documento text NOT NULL,
  nombre text,
  aseguradora text,
  profesional text,
  servicio text,
  procedimiento text,
  cq text,
  fecha date,
  inicio time,
  fin time,
  fase text,
  raw_json jsonb,
  scraped_at timestamptz DEFAULT now(),
  UNIQUE (clinic_id, isalud_agenda_id)
);
CREATE INDEX IF NOT EXISTS idx_hist_rows_clinic_doc ON isalud_historico_rows(clinic_id, documento);

CREATE TABLE IF NOT EXISTS isalud_historico_scrape_log (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  documento text NOT NULL,
  scraped_at timestamptz DEFAULT now(),
  row_count int DEFAULT 0,
  ok boolean DEFAULT true,
  error text,
  PRIMARY KEY (clinic_id, documento)
);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS entidad_isalud text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS tratante_doctor_id uuid REFERENCES doctors(id) ON DELETE SET NULL;

ALTER TABLE isalud_historico_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE isalud_historico_scrape_log ENABLE ROW LEVEL SECURITY;
