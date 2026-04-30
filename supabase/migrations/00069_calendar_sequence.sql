-- ============================================================
-- Migration 00069: Add calendar_sequence to appointments
-- Tracks .ics SEQUENCE number for create/reschedule/cancel
-- ============================================================

ALTER TABLE appointments
ADD COLUMN calendar_sequence INTEGER DEFAULT 0;
