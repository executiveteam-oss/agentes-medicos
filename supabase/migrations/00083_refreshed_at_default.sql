-- ============================================================
-- 00083_refreshed_at_default.sql
-- Fix review I2: las alertas de crisis se insertan sin refreshed_at → NULL.
-- La campana ordena por (refreshed_at DESC NULLS LAST, created_at DESC), así
-- que una escalación REFRESCADA (refreshed_at seteado) flotaba ARRIBA de una
-- crisis NUEVA (refreshed_at NULL) en el reload. Con slice(0,10) en el panel,
-- bajo carga de lanzamiento la crisis podía quedar fuera de vista.
--
-- Fix: refreshed_at DEFAULT now() → TODA fila nueva (crisis, escalación, etc.)
-- lleva su timestamp de última actividad. El orden colapsa a "actividad más
-- reciente primero": una crisis fresca queda arriba salvo que exista actividad
-- genuinamente posterior. Las filas viejas quedan NULL (sort last) — correcto.
--
-- Aditiva, sin backfill. Aplicada en producción: 2026-07-27.
-- ============================================================
BEGIN;

ALTER TABLE staff_notifications ALTER COLUMN refreshed_at SET DEFAULT now();

COMMIT;
