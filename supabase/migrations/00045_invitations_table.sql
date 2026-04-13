-- Migración 00045: Tabla de invitaciones con token propio
-- Reemplaza inviteUserByEmail de Supabase para usar Resend como SMTP

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role_id UUID NOT NULL,
  token TEXT UNIQUE NOT NULL,
  invited_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations (token) WHERE accepted_at IS NULL;
