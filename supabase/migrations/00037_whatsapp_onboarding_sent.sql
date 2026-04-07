-- ============================================================
-- Migración 00037: Flag para onboarding WhatsApp al admin
-- Evita enviar la secuencia de bienvenida más de una vez
-- ============================================================

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_onboarding_sent BOOLEAN DEFAULT false;
