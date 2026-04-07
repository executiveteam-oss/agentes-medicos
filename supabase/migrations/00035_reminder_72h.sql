-- ============================================================
-- Migración 00035: Agregar columna reminder_72h_sent a appointments
-- y campo reminder_72h al notification_settings JSONB de clinics
-- ============================================================

-- Columna para rastrear si se envió el recordatorio de 72h
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_72h_sent BOOLEAN DEFAULT false;

-- Actualizar notification_settings de clínicas existentes para incluir reminder_72h: false
UPDATE clinics
SET notification_settings = notification_settings || '{"reminder_72h": false}'::jsonb
WHERE notification_settings IS NOT NULL
  AND NOT (notification_settings ? 'reminder_72h');
