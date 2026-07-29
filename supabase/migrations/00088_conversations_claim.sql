-- ============================================================
-- 00088_conversations_claim.sql
-- Pieza A — Claim de conversaciones. 3 columnas nullable.
-- Config por clínica vive en clinics.feature_config.claim (JSONB), sin columna.
-- Vencimiento se computa AL LEER, no hay estado derivado persistido.
-- ============================================================
BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES clinic_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.claimed_by IS
  'Pieza A claim: quién tomó la conversación. Vencimiento se computa al leer (claimed_at + feature_config.claim.expiry_minutes). claimed_by_name denormalizado para display sin join.';

COMMIT;
