-- ============================================================
-- Migración: Tipos de consulta por doctor
-- Permite definir diferentes tipos de consulta con duración,
-- precio y preparación previa por doctor
-- ============================================================

CREATE TABLE consultation_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  requires_preparation BOOLEAN DEFAULT false,
  preparation_instructions TEXT,
  price INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para consultas frecuentes por doctor
CREATE INDEX idx_consultation_types_doctor ON consultation_types(doctor_id, is_active);
CREATE INDEX idx_consultation_types_clinic ON consultation_types(clinic_id);

-- RLS
ALTER TABLE consultation_types ENABLE ROW LEVEL SECURITY;

-- Política: usuarios autenticados pueden ver los de su clínica
CREATE POLICY "consultation_types_select" ON consultation_types
  FOR SELECT USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
    )
  );

-- Política: usuarios autenticados pueden insertar en su clínica
CREATE POLICY "consultation_types_insert" ON consultation_types
  FOR INSERT WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
    )
  );

-- Política: usuarios autenticados pueden actualizar en su clínica
CREATE POLICY "consultation_types_update" ON consultation_types
  FOR UPDATE USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
    )
  );

-- Política: usuarios autenticados pueden eliminar en su clínica
CREATE POLICY "consultation_types_delete" ON consultation_types
  FOR DELETE USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
    )
  );

-- Columna opcional en appointments para vincular el tipo de consulta
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consultation_type_id UUID REFERENCES consultation_types(id);
