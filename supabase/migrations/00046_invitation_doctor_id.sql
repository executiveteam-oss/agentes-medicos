-- Migración 00046: Agregar doctor_id a invitations
-- Permite vincular automáticamente el doctor profile al aceptar la invitación

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL;
