-- ============================================================
-- 00086_messages_sender_name.sql
-- Atribución de mensajes del staff. Hoy messages.role='staff' NO guarda QUIÉN
-- envió → el chat etiquetaba toda burbuja de staff con el nombre del que MIRA
-- (staffName del viewer), o sea información falsa en multi-usuario.
-- Agrega sender_name (display) para el mensaje manual del staff. NULL en las
-- filas existentes (irrecuperables — el audit tampoco tenía actor_id) → el
-- render las muestra como "Equipo", nunca un nombre equivocado.
-- Aditiva. Aplicada en producción: 2026-07-29.
-- ============================================================
BEGIN;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT;

COMMIT;
