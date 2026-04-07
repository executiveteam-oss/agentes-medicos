-- ============================================================
-- Migración 00036: Checklist de activación post-onboarding
-- Tabla para rastrear progreso de configuración de cada clínica
-- ============================================================

CREATE TABLE clinic_setup_progress (
  clinic_id UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  clinic_data_complete BOOLEAN DEFAULT false,
  doctors_added BOOLEAN DEFAULT false,
  consultation_types_added BOOLEAN DEFAULT false,
  whatsapp_connected BOOLEAN DEFAULT false,
  team_invited BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE clinic_setup_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_setup_progress_select"
  ON clinic_setup_progress FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "clinic_setup_progress_update"
  ON clinic_setup_progress FOR UPDATE
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid()
  ));

-- Crear registro para clínicas que ya completaron onboarding
INSERT INTO clinic_setup_progress (clinic_id)
SELECT id FROM clinics WHERE onboarded_at IS NOT NULL
ON CONFLICT DO NOTHING;
