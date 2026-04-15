-- Migración 00049: UNIQUE constraint en whatsapp_phone_id
-- Previene que dos clínicas registren el mismo número de WhatsApp
ALTER TABLE clinics
ADD CONSTRAINT clinics_whatsapp_phone_id_unique
UNIQUE (whatsapp_phone_id);
