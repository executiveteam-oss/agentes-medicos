-- ============================================================
-- Migración: Credenciales WhatsApp por clínica
-- Agrega columnas para que cada clínica almacene sus propias
-- credenciales de WhatsApp Business API
-- ============================================================

-- Access token de WhatsApp (token permanente de System User)
-- Ya existe whatsapp_token pero usamos una nueva columna con nombre más claro
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT;

-- App Secret de la aplicación en Meta
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_app_secret TEXT;

-- Verify token único por clínica (para verificar webhook en Meta)
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_verify_token TEXT;

-- Indica si la conexión de WhatsApp fue verificada exitosamente
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_connected BOOLEAN DEFAULT false;

-- Nombre para mostrar del número de WhatsApp (se obtiene al verificar)
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_display_name TEXT;

-- Número de teléfono verificado (formato +57...)
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_phone_display TEXT;

-- Fecha de la primera conexión exitosa
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_connected_at TIMESTAMPTZ;
