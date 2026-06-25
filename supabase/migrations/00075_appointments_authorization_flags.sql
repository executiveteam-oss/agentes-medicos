-- ============================================================
-- 00075_appointments_authorization_flags.sql
-- Bloque 4 — Autorización por convenio. Flags en appointments
-- para citas que requieren autorización direccionada validada
-- por un humano. La cita se crea solo DESPUÉS de aprobación.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN requires_authorization BOOLEAN DEFAULT false,
  ADD COLUMN authorization_convenio TEXT,
  ADD COLUMN authorization_validated_at TIMESTAMPTZ,
  ADD COLUMN authorization_validated_by UUID REFERENCES clinic_users(id),
  ADD COLUMN authorization_media_id UUID;

CREATE INDEX idx_appointments_requires_auth
  ON appointments(clinic_id, requires_authorization)
  WHERE requires_authorization = true;

COMMENT ON COLUMN appointments.requires_authorization IS
  'Bloque 4: cita que requiere autorización direccionada del convenio. El equipo de admisión revisa el flag.';
COMMENT ON COLUMN appointments.authorization_convenio IS
  'Nombre del convenio que disparó el requisito (para trazabilidad).';
COMMENT ON COLUMN appointments.authorization_validated_at IS
  'Cuándo el staff validó la autorización (NULL si nunca se validó).';
COMMENT ON COLUMN appointments.authorization_validated_by IS
  'Usuario que validó (FK a clinic_users).';
COMMENT ON COLUMN appointments.authorization_media_id IS
  'Referencia al archivo de autorización en conversation_media (FK se agrega en migración 00076).';
