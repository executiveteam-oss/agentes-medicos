-- ============================================================
-- Migración: Whitelist de servicios agendables por WhatsApp
-- bookable_via_whatsapp: si el agente puede ofrecer este servicio
-- requires_documents: si requiere documentos previos
-- required_documents_description: instrucciones de documentos
-- ============================================================

ALTER TABLE consultation_types ADD COLUMN IF NOT EXISTS bookable_via_whatsapp BOOLEAN DEFAULT true;
ALTER TABLE consultation_types ADD COLUMN IF NOT EXISTS requires_documents BOOLEAN DEFAULT false;
ALTER TABLE consultation_types ADD COLUMN IF NOT EXISTS required_documents_description TEXT;
