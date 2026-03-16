-- ============================================================
-- Migración 00017: Agregar prioridad a lista de espera
-- ============================================================

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgente'));
