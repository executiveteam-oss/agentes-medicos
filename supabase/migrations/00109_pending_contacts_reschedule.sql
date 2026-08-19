-- ============================================================
-- Un aviso de "tu cita se movió" que NO se entregó tiene que aparecer en
-- Pendientes.
--
-- POR QUÉ
-- Al conectar la edición de citas desde el panel (commit 1444578) apareció un
-- caso nuevo: la secretaria mueve una cita, el WhatsApp de aviso falla, y la
-- paciente sigue creyendo que su cita es el día viejo. Va a ir ese día.
--
-- El CHECK sólo admitía tres motivos, así que ese caso quedaba en `audit_log`
-- (appointment_move_notify_failed) y en un warning en pantalla que la
-- secretaria puede cerrar sin leer. Una paciente que no se enteró de que le
-- movieron la cita es justo lo que la pantalla de Pendientes existe para
-- mostrar.
--
-- APLICADA el 2026-08-19 con `apply_migration` (NO con `db push`: el historial
-- de este proyecto está partido en dos esquemas de nombres y un push
-- re-aplicaría 38 migraciones ya aplicadas sobre producción).
-- No tocó ninguna fila: la tabla estaba vacía y el valor sólo se AGREGA.
-- ============================================================

alter table public.pending_contacts
  drop constraint if exists pending_contacts_reason_type_check;

alter table public.pending_contacts
  add constraint pending_contacts_reason_type_check
  check (reason_type = any (array[
    'reminder_failed'::text,
    'cancellation_no_delivery'::text,
    'waitlist_notification_failed'::text,
    'reschedule_no_delivery'::text
  ]));
