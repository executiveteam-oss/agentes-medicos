-- ============================================================
-- 00084_data_rights_notification.sql
-- Capa 0 — solicitudes sobre datos personales (ARCO):
--   agrega 'data_rights_request' al CHECK de staff_notifications.type.
-- Aditiva y reversible. El nuevo CHECK es superconjunto del actual → ninguna
-- fila existente lo viola. BEGIN/COMMIT explícito.
-- ============================================================
BEGIN;

ALTER TABLE staff_notifications DROP CONSTRAINT IF EXISTS staff_notifications_type_check;
ALTER TABLE staff_notifications ADD CONSTRAINT staff_notifications_type_check
  CHECK (type IN (
    'appointment_canceled',
    'appointment_rescheduled',
    'appointment_moved',
    'conversation_escalated',
    'crisis_detected',
    'data_rights_request'
  ));

COMMIT;
