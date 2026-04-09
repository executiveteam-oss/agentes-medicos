-- Migración 00041: Agregar invitation_code a clinics
-- Permite rastrear qué código de invitación usó cada clínica al registrarse

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS invitation_code TEXT;
