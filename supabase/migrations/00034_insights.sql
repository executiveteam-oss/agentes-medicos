-- ============================================================
-- Tabla para recomendaciones de Omuwan Insights
-- Generadas diariamente por IA a partir de datos reales
-- ============================================================

CREATE TABLE clinic_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recommendations JSONB NOT NULL,
  data_snapshot JSONB,
  model_used TEXT DEFAULT 'claude-sonnet-4-20250514',
  is_read BOOLEAN DEFAULT false,
  feedback JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_clinic_insights_clinic ON clinic_insights(clinic_id, generated_at DESC);

ALTER TABLE clinic_insights ENABLE ROW LEVEL SECURITY;
