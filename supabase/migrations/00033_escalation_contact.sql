-- ============================================================
-- Agregar número de contacto para escalamientos
-- ============================================================

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS escalation_contact_phone TEXT;

COMMENT ON COLUMN clinics.escalation_contact_phone IS 'Phone number (+57...) to receive WhatsApp alerts on escalations';
