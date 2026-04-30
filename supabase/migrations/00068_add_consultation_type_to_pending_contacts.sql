-- ============================================================
-- Migration 00068: Add consultation_type to pending_contacts
-- Denormalized name for display in the panel without JOINs
-- ============================================================

ALTER TABLE pending_contacts
ADD COLUMN consultation_type TEXT;
