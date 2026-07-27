-- ============================================================
-- 00082_crisis_detection.sql
-- Capa 0 de seguridad:
--   - Agrega 'crisis_detected' al CHECK de staff_notifications.type.
--   - Agrega refreshed_at para el fix de "zona muerta" (re-surface de la
--     alerta cuando el paciente vuelve a escribir en una conversación escalada).
-- Aditiva y reversible. El nuevo CHECK es superconjunto del actual → ninguna
-- fila existente lo viola. BEGIN/COMMIT explícito.
-- Aplicada en producción: 2026-07-27.
-- ============================================================
BEGIN;

ALTER TABLE staff_notifications DROP CONSTRAINT IF EXISTS staff_notifications_type_check;
ALTER TABLE staff_notifications ADD CONSTRAINT staff_notifications_type_check
  CHECK (type IN (
    'appointment_canceled',
    'appointment_rescheduled',
    'appointment_moved',
    'conversation_escalated',
    'crisis_detected'
  ));

ALTER TABLE staff_notifications ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ;

COMMIT;
