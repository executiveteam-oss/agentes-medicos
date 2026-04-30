-- ============================================================
-- Migration 00066: Pending patient contacts
-- Tracks patients who couldn't be reached via WhatsApp
-- for manual follow-up by staff
-- ============================================================

CREATE TABLE pending_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

  -- What failed
  reason_type TEXT NOT NULL CHECK (reason_type IN (
    'reminder_failed',
    'cancellation_no_delivery',
    'waitlist_notification_failed'
  )),
  reason_text TEXT NOT NULL,

  -- Patient context (denormalized for fast reads without JOINs)
  patient_name TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  doctor_name TEXT,
  appointment_date TIMESTAMPTZ,

  -- Resolution
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_method TEXT, -- 'manual_whatsapp', 'resend_success', 'auto_expired'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup: pending items per clinic
CREATE INDEX idx_pending_contacts_clinic_pending
  ON pending_contacts(clinic_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- Prevent exact duplicates (same appointment + reason while unresolved)
CREATE UNIQUE INDEX idx_pending_contacts_unique_source
  ON pending_contacts(clinic_id, appointment_id, reason_type)
  WHERE resolved_at IS NULL;

-- RLS
ALTER TABLE pending_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_contacts_select" ON pending_contacts
  FOR SELECT TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "pending_contacts_update" ON pending_contacts
  FOR UPDATE TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
  ));

-- Service role inserts (from crons and webhook)
-- No INSERT policy for authenticated

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE pending_contacts;
