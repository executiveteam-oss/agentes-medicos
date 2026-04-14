-- Migración 00047: iSalud Sync Agent — tablas y columnas

-- Tabla de integraciones de sincronización (provider-agnóstica)
CREATE TABLE IF NOT EXISTS sync_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'isalud',
  credentials JSONB NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{"dias_adelante": 60}',
  sync_status TEXT NOT NULL DEFAULT 'idle',
  last_synced_at TIMESTAMPTZ,
  sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, provider)
);

-- Mapeo de nombres de profesionales externos a doctores de Omuwan
CREATE TABLE IF NOT EXISTS doctor_external_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'isalud',
  external_name TEXT NOT NULL,
  external_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, provider, external_name)
);

-- Columnas adicionales en appointments para tracking de sync
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_data JSONB,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- Índice para disponibilidad del agente — excluye slots bloqueados
CREATE INDEX IF NOT EXISTS idx_appointments_availability
  ON appointments (doctor_id, starts_at, status)
  WHERE status NOT IN ('cancelled', 'no_show');

-- Índice para queries de sync
CREATE INDEX IF NOT EXISTS idx_appointments_external_source
  ON appointments (clinic_id, external_source, status, starts_at)
  WHERE external_source IS NOT NULL;

-- RLS
ALTER TABLE sync_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_external_mappings ENABLE ROW LEVEL SECURITY;
