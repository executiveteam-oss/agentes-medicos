-- ============================================================
-- Campos adicionales de configuración de la clínica
-- contact_email, website, logo_url, notification_settings
-- ============================================================

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{
    "reminder_24h": true,
    "reminder_2h": false,
    "morning_report": true,
    "morning_report_hour": "06:00",
    "noshow_alert": false,
    "noshow_alert_threshold": 30,
    "overdue_billing_alert": false,
    "overdue_billing_days": 30
  }'::jsonb;
