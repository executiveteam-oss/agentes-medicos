-- Migración 00078: columnas para feature "Encuesta post-consulta"
--
-- Aisladas del followup_sent legacy (que sigue vivo para el NPS conversacional
-- 1-10 activado desde whatsapp_config.automations.post_consulta).
--
-- Nueva feature (survey) usa:
--   - attendance_outcome='facturado' como disparador
--   - template Meta pre-aprobado con link a Google Form / Typeform / etc.
--   - config en whatsapp_config.automations.survey
--   - flag maestro en feature_config.survey_post_consulta_enabled
--
-- Ver CLAUDE.md sección "Feature: encuesta post-consulta".

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS survey_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS survey_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN appointments.survey_sent IS
  'True cuando el cron survey-post-consulta ya envió la encuesta para esta cita. Usado para idempotencia — no re-enviar.';

COMMENT ON COLUMN appointments.survey_sent_at IS
  'Timestamp del envío exitoso de la encuesta post-consulta. NULL = no enviada. Se popula junto con survey_sent=true.';

-- Índice parcial para acelerar el cron: solo indexa citas facturadas pendientes de encuesta.
-- El cron va a hacer: WHERE attendance_outcome='facturado' AND survey_sent=false AND starts_at >= now() - interval 'X hours'
CREATE INDEX IF NOT EXISTS idx_appointments_survey_pending
  ON appointments (clinic_id, starts_at DESC)
  WHERE attendance_outcome = 'facturado' AND survey_sent = false;
