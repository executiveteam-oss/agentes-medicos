-- ============================================================
-- Tratante por (paciente, ESPECIALIDAD), no uno por paciente. Una paciente que
-- hace fisioterapia Y ginecología tiene un tratante para cada una.
-- jsonb keyed por especialidad normalizada:
--   { "GINECOLOGIA": {"doctor_id":"…","source":"isalud","updated_at":"…"},
--     "FISIOTERAPIA": {"doctor_id":"…","source":"secretaria","updated_at":"…"} }
-- source: 'isalud' | 'paciente' | 'secretaria'. El --derive nunca pisa humano.
-- La columna single tratante_doctor_id queda DEPRECADA (la reemplaza esto).
-- ============================================================

ALTER TABLE patients ADD COLUMN IF NOT EXISTS tratantes jsonb;
