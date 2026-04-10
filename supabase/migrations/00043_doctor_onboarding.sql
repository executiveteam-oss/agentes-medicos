-- Migración 00043: Tracking de onboarding del doctor
-- Marca cuándo el doctor completó su configuración inicial (horario + tipos de consulta)

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ DEFAULT NULL;
