-- ============================================================
-- Migración 00038: Tabla de estado del sistema (página pública /status)
-- ============================================================

CREATE TABLE system_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'operational', -- operational, degraded, outage
  message TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed con todos los componentes
INSERT INTO system_status (component, status) VALUES
  ('whatsapp_agent', 'operational'),
  ('web_dashboard', 'operational'),
  ('reminders', 'operational'),
  ('appointments', 'operational'),
  ('database', 'operational');

-- RLS: lectura pública (sin auth), escritura solo desde service_role
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_status_public_read"
  ON system_status FOR SELECT
  USING (true);
