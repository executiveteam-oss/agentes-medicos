-- ============================================================
-- 00087_clinics_privacy_policy_url.sql
-- URL de la política de privacidad POR CLÍNICA (multi-tenant — cada IPS tiene la
-- suya, no se hardcodea). Si está configurada, una CONSULTA de política se
-- responde con el link; si es NULL, el comportamiento no cambia (acuse +
-- escalación). Nullable. Aplicada en producción: 2026-07-29.
-- Se puebla Algia con su política de tratamiento de datos publicada.
-- ============================================================
BEGIN;

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS privacy_policy_url TEXT;

UPDATE clinics
SET privacy_policy_url = 'https://algia.com.co/politica-de-tratamiento-de-datos-personales/'
WHERE id = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb';

COMMIT;
