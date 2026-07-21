-- ============================================================
-- 00081_doctors_daily_summary_enabled.sql
--
-- Flag por-médico del resumen diario de citas (cron morning-report).
-- Opt-in: default false para todos — nadie recibe resumen hasta que se
-- active el toggle Y tenga teléfono cargado.
--
-- Invariante (enforced en las server actions, no en la DB): resumen
-- activo ⟹ el médico tiene teléfono. Borrar el teléfono apaga el flag.
--
-- Aplicada en producción: 2026-07-21 (BEGIN/COMMIT explícito).
-- ============================================================

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS daily_summary_enabled BOOLEAN NOT NULL DEFAULT false;
