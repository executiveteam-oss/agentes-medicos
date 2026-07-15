-- ============================================================
-- 00080_staff_notifications_escalation.sql
--
-- Habilita notificaciones in-app de escalación de conversaciones.
--   - Agrega 'conversation_escalated' al CHECK de type.
--   - Agrega columna conversation_id (real, indexable) para resolución
--     clinic-wide: al atender, se limpian TODAS las notifs de esa
--     conversación de una sola query.
--   - Índice parcial para: (a) el chequeo de idempotencia del helper y
--     (b) la resolución. Solo cubre escalaciones no resueltas.
--
-- Aplicada en producción: 2026-07-15 (envuelta en BEGIN/COMMIT explícito
-- para que el drop+recreate del CHECK sea atómico sin depender del runner).
-- ============================================================

ALTER TABLE staff_notifications DROP CONSTRAINT IF EXISTS staff_notifications_type_check;

ALTER TABLE staff_notifications ADD CONSTRAINT staff_notifications_type_check
  CHECK (type IN (
    'appointment_canceled',
    'appointment_rescheduled',
    'appointment_moved',
    'conversation_escalated'
  ));

ALTER TABLE staff_notifications
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notif_conv_escalated
  ON staff_notifications(conversation_id)
  WHERE type = 'conversation_escalated' AND read_at IS NULL;
