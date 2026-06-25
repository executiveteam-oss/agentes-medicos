-- ============================================================
-- 00076_conversation_media.sql
-- Bloque 4 — Recepción de archivos (imágenes + PDFs) de WhatsApp.
-- Tabla de tracking + bucket privado en Storage.
--
-- CRÍTICO: este feature está CONSTRUIDO pero NO ACTIVO. El feature_flag
-- "media_reception_enabled" por clínica controla la activación
-- (migración 00077).
--
-- Almacenamiento: bucket privado con RLS. URLs firmadas TTL corto.
-- Acceso: solo usuarios con permission authorizations.review.
-- Audit: cada acceso queda en audit_log (action='media_accessed').
-- ============================================================

CREATE TABLE conversation_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  whatsapp_media_id TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'document')),
  mime_type TEXT,
  filename TEXT,
  storage_path TEXT NOT NULL,
  size_bytes INTEGER,
  context TEXT CHECK (context IN ('authorization', 'document_general', 'other') OR context IS NULL),
  reviewed_by UUID REFERENCES clinic_users(id),
  reviewed_at TIMESTAMPTZ,
  review_decision TEXT CHECK (review_decision IN ('approved', 'rejected') OR review_decision IS NULL),
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_media_conversation ON conversation_media(conversation_id);
CREATE INDEX idx_conv_media_pending_review ON conversation_media(clinic_id, reviewed_at, context)
  WHERE reviewed_at IS NULL;
CREATE INDEX idx_conv_media_clinic ON conversation_media(clinic_id);

ALTER TABLE conversation_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_select_own_clinic ON conversation_media
  FOR SELECT TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY media_insert_own_clinic ON conversation_media
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY media_update_own_clinic ON conversation_media
  FOR UPDATE TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

-- FK que faltaba en migración 00075 (referencia a conversation_media)
ALTER TABLE appointments
  ADD CONSTRAINT fk_appointments_authorization_media
  FOREIGN KEY (authorization_media_id) REFERENCES conversation_media(id) ON DELETE SET NULL;

-- Bucket privado en Storage. Si ya existe (por seed o test), no falla.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'whatsapp-media', 'whatsapp-media', false,
  26214400,  -- 25 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE conversation_media IS
  'Bloque 4: archivos recibidos por WhatsApp (autorizaciones, documentos). Cada acceso queda en audit_log. Construido pero NO activo hasta feature_flag media_reception_enabled=true por clínica.';
