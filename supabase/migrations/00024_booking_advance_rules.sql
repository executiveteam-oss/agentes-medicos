-- ============================================================
-- Migración: Reglas de anticipación para agendamiento
-- min_booking_advance_hours: mínimo de horas antes de la cita
-- max_booking_advance_days: máximo de días hacia el futuro
-- ============================================================

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS min_booking_advance_hours INTEGER DEFAULT 24;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS max_booking_advance_days INTEGER DEFAULT 60;
