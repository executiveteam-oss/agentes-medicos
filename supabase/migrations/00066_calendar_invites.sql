-- ============================================================
-- Calendar invites hosteados (.ics con URL firmada)
-- El adjunto por WhatsApp está muerto: Meta no acepta text/calendar
-- y text/plain se renombra a .TXT. En su lugar, hosteamos el .ics en un
-- bucket PRIVADO y mandamos un link a nuestra ruta /cita/{token}, que
-- redirige a un signed URL de 60s. El archivo vive hasta que pasa la cita.
-- ============================================================

-- Ruta del .ics en Storage para cada cita (nullable; NULL = sin invite o purgado).
-- El token de la URL = el UUID del nombre de archivo ({uuid}.ics).
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS calendar_ics_path TEXT;

-- Lookup por token en la ruta pública /cita/{token} + barrido de purga.
CREATE INDEX IF NOT EXISTS idx_appointments_calendar_ics_path
  ON appointments(calendar_ics_path) WHERE calendar_ics_path IS NOT NULL;

-- Bucket PRIVADO solo para .ics. Separado de whatsapp-media (documentos
-- clínicos entrantes, retención 2 años, dato sensible): distinto ciclo de
-- vida, distinto riesgo. Sin políticas para anon → acceso solo por
-- service_role (upload/purga) y signed URLs efímeros. El límite de 64KB
-- es holgado (un .ics pesa ~1.5KB).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('calendar-invites', 'calendar-invites', false, 65536, ARRAY['text/calendar'])
ON CONFLICT (id) DO NOTHING;
