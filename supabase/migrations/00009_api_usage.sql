-- ============================================================
-- Migración 00009: Tabla de uso de API por clínica (token tracking)
-- Rastreo mensual de tokens consumidos por clínica para limitar costos
-- ============================================================

-- Tabla de uso mensual de API por clínica
CREATE TABLE IF NOT EXISTS api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    month TEXT NOT NULL,                    -- "2026-03" formato YYYY-MM
    input_tokens BIGINT DEFAULT 0,
    output_tokens BIGINT DEFAULT 0,
    api_calls INTEGER DEFAULT 0,
    paused_at TIMESTAMPTZ,                  -- null = activo, fecha = pausado por exceder límite
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(clinic_id, month)
);

-- Índice para búsquedas por clínica y mes
CREATE INDEX IF NOT EXISTS idx_api_usage_clinic_month ON api_usage(clinic_id, month);

-- RLS
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver uso de mi clínica" ON api_usage
    FOR SELECT TO authenticated
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
    ));
