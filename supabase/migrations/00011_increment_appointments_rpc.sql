-- ============================================================
-- RPC: incrementar total_appointments de un paciente de forma atómica
-- Evita race conditions al usar SET total_appointments = total_appointments + 1
-- ============================================================

CREATE OR REPLACE FUNCTION increment_patient_appointments(p_patient_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE patients
  SET total_appointments = COALESCE(total_appointments, 0) + 1,
      updated_at = NOW()
  WHERE id = p_patient_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
