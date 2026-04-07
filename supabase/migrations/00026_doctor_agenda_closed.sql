-- ============================================================
-- Migración: Cerrar agenda por doctor
-- Permite bloquear temporalmente la disponibilidad de un doctor
-- ============================================================

ALTER TABLE doctors ADD COLUMN IF NOT EXISTS agenda_closed BOOLEAN DEFAULT false;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS agenda_closed_reason TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS agenda_closed_until DATE;
