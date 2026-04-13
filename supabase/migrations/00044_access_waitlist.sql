-- Migración 00044: Tabla waitlist de acceso anticipado
-- Almacena solicitudes de clínicas interesadas en Omuwan

CREATE TABLE IF NOT EXISTS access_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  clinic_name TEXT NOT NULL,
  city TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  specialty TEXT,
  doctor_range TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_waitlist_status ON access_waitlist (status);
