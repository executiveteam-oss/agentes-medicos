-- ============================================================
-- Migration 00064: Staff notifications for appointment changes
-- In-app notifications when patients cancel/reschedule via WhatsApp
-- ============================================================

CREATE TABLE staff_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  recipient_user_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('appointment_canceled', 'appointment_rescheduled', 'appointment_moved')),
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB DEFAULT '{}',
  navigate_to TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup: unread notifications per user, newest first
CREATE INDEX idx_notif_recipient_unread
  ON staff_notifications(recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Clinic-wide queries
CREATE INDEX idx_notif_clinic ON staff_notifications(clinic_id);

-- Cleanup cron uses sequential scan (table is small, ~1000 rows max)
CREATE INDEX idx_notif_created ON staff_notifications(created_at);

-- RLS: each user only sees their own notifications
ALTER TABLE staff_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select_own" ON staff_notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY "notif_update_own" ON staff_notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid());

-- Service role can INSERT (from webhook endpoint)
-- No INSERT policy for authenticated — only server creates notifications

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE staff_notifications;
