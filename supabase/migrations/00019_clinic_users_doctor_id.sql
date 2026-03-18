-- ============================================================
-- Vincular usuarios con rol Doctor a su registro en doctors
-- Permite filtrar la agenda por doctor cuando un médico inicia sesión
-- ============================================================

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL;

-- Índice para buscar rápidamente qué usuario está vinculado a un doctor
CREATE INDEX IF NOT EXISTS idx_clinic_users_doctor ON clinic_users(doctor_id) WHERE doctor_id IS NOT NULL;
