-- ============================================================
-- Migración: feature_config + plan preferences en clinics
-- Almacena configuración de features del configurador de pricing
-- ============================================================

-- Columnas nuevas
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS feature_config JSONB DEFAULT '{
    "agent": true,
    "reminders_24h": true,
    "reminders_72h": false,
    "docs_required": false,
    "waitlist": false,
    "reactivation": false,
    "dashboard": true,
    "insights": false,
    "virtual": false
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS preferred_plan TEXT,
  ADD COLUMN IF NOT EXISTS expected_doctors INTEGER,
  ADD COLUMN IF NOT EXISTS expected_monthly_appointments INTEGER;

-- Clínicas existentes: todas las features activas (no romper nada)
UPDATE clinics
SET feature_config = '{
  "agent": true,
  "reminders_24h": true,
  "reminders_72h": true,
  "docs_required": true,
  "waitlist": true,
  "reactivation": true,
  "dashboard": true,
  "insights": true,
  "virtual": true
}'::jsonb
WHERE feature_config IS NULL
   OR feature_config = '{
    "agent": true,
    "reminders_24h": true,
    "reminders_72h": false,
    "docs_required": false,
    "waitlist": false,
    "reactivation": false,
    "dashboard": true,
    "insights": false,
    "virtual": false
  }'::jsonb;
