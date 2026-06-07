-- ============================================================
-- Migración 00072: Schema para Reporte Resolución 256/16
-- Sub-fase 1 — solo columnas nuevas, sin backfill.
-- ============================================================

-- 1. patients: 4 fields nombre + gender + eapb_code
ALTER TABLE patients
  ADD COLUMN first_name TEXT,
  ADD COLUMN middle_name TEXT,
  ADD COLUMN first_last_name TEXT,
  ADD COLUMN second_last_name TEXT,
  ADD COLUMN gender TEXT CHECK (gender IN ('M', 'F')),
  ADD COLUMN eapb_code VARCHAR(6);

-- 2. document_type: extender CHECK para incluir MS y AS
--    Como hoy es TEXT sin CHECK, agregamos uno con todos los valores válidos
ALTER TABLE patients
  ADD CONSTRAINT patients_document_type_check
    CHECK (document_type IN ('CC', 'TI', 'CE', 'PP', 'RC', 'PA', 'MS', 'AS'));

-- 3. appointments: requested_at + desired_at
ALTER TABLE appointments
  ADD COLUMN requested_at TIMESTAMPTZ,
  ADD COLUMN desired_at DATE;

-- 4. consultation_types: res256_category
ALTER TABLE consultation_types
  ADD COLUMN res256_category TEXT
    CHECK (res256_category IN ('Ginecología', 'Obstetricia', 'Ecografía', 'Resonancia Magnética', 'NoAplica'));

-- 5. Tabla eapb_codes (CRUD UI viene en Fase 2; en Fase 1 es source-of-truth para validación)
CREATE TABLE eapb_codes (
  code VARCHAR(6) PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('EPS', 'Prepagada', 'Plan Complementario')),
  aliases TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE eapb_codes IS
  'Códigos EAPB del MinSalud Colombia para reporte Resolución 256. Seed Fase 1; UI CRUD en Fase 2.';

-- 6. Seed inicial de ~20 códigos (las EPS/Prepagadas de Algia + comunes).
--    Códigos reales del catálogo SISPRO (consultados al diseñar Fase 1).
--    El campo aliases captura variantes que pueden aparecer en patients.eps o appointments.eps_name.
INSERT INTO eapb_codes (code, name, type, aliases) VALUES
  -- EPS contributivas
  ('EPS037', 'Nueva EPS', 'EPS', ARRAY['nueva eps', 'nueva']),
  ('EPS010', 'Salud Total', 'EPS', ARRAY['salud total']),
  ('EPS017', 'Famisanar', 'EPS', ARRAY['famisanar']),
  ('EPS023', 'Compensar', 'EPS', ARRAY['compensar']),
  ('EPS016', 'Coomeva EPS', 'EPS', ARRAY['coomeva eps']),  -- liquidada pero código histórico válido
  ('EPS002', 'SOS', 'EPS', ARRAY['sos', 'servicio occidental de salud']),
  ('EPS018', 'Sanitas EPS', 'EPS', ARRAY['eps sanitas', 'sanitas eps']),
  ('EPS005', 'Sura EPS', 'EPS', ARRAY['sura', 'sura eps', 'suramericana eps']),
  ('EPS012', 'Coosalud', 'EPS', ARRAY['coosalud']),
  ('EPS015', 'Aliansalud', 'EPS', ARRAY['aliansalud', 'alian salud']),
  ('EPS013', 'Comfenalco', 'EPS', ARRAY['comfenalco']),
  ('EPS022', 'Mutual Ser', 'EPS', ARRAY['mutual ser', 'mutualser']),
  -- Prepagadas
  ('PRE001', 'Colsanitas', 'Prepagada', ARRAY['colsanitas']),
  ('PRE002', 'Sura Prepagada', 'Prepagada', ARRAY['sura prepagada']),
  ('PRE003', 'Coomeva Prepagada', 'Prepagada', ARRAY['coomeva', 'coomeva prepagada', 'coomeva medicina prepagada']),
  ('PRE004', 'Colmédica', 'Prepagada', ARRAY['colmedica', 'colmédica']),
  ('PRE005', 'Allianz Salud', 'Prepagada', ARRAY['allianz', 'allianz salud', 'allianz seguros de vida']),
  ('PRE006', 'AXA Colpatria Prepagada', 'Prepagada', ARRAY['axa', 'axa colpatria', 'colpatria']),
  ('PRE007', 'MediPlus', 'Prepagada', ARRAY['mediplus', 'medi plus']);

-- 7. Índices auxiliares para el reporte
CREATE INDEX idx_appointments_clinic_status_starts ON appointments(clinic_id, status, starts_at)
  WHERE status IN ('confirmed', 'rescheduled', 'completed', 'no_show');
CREATE INDEX idx_eapb_codes_aliases_gin ON eapb_codes USING gin (aliases);
