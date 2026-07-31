-- ============================================================
-- Opt-in EXPLÍCITO de contacto proactivo por WhatsApp.
-- SEPARADO de data_consent_at (Ley 1581) a propósito: recibir WhatsApp
-- proactivo (recordatorio/encuesta/reactivación) es opt-in de CANAL, distinto
-- del consentimiento de tratamiento de datos. Mezclarlos haría imposible
-- implementar la respuesta de Algia a uno sin desarmar el otro.
--
-- DEFAULT false para TODOS (incluidos los ~493 ya existentes): nadie recibe
-- proactivo hasta un opt-in explícito. Se prende:
--   1) hacia adelante: cuando la paciente agenda por el agente (source=whatsapp_agent)
--   2) en masa: UPDATE ... SET proactive_contact_opt_in=true (decisión de la clínica)
-- Los 4 crons proactivos (send-reminders, post-consulta, reactivacion,
-- survey-post-consulta) filtran por este campo antes de enviar.
-- ============================================================
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS proactive_contact_opt_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN patients.proactive_contact_opt_in IS
  'Opt-in de canal WhatsApp proactivo (recordatorio/encuesta/reactivación). NO es el consentimiento Ley 1581 (ver data_consent_at). Default false; los crons proactivos NO envían si es false.';
