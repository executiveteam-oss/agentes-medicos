-- ============================================================
-- Columna whatsapp_config en clinics
-- Configuración del agente de WhatsApp por clínica
-- ============================================================

ALTER TABLE clinics
ADD COLUMN IF NOT EXISTS whatsapp_config JSONB DEFAULT '{
  "schedule": {
    "start": "07:00",
    "end": "20:00",
    "days": [1,2,3,4,5,6],
    "out_of_hours_message": "Hola, nuestro horario de atención es de 7am a 8pm. Te responderemos mañana."
  },
  "appointment": {
    "default_duration": 30,
    "max_duration": 60
  },
  "escalation_keywords": ["urgencia","dolor","emergencia","hablar con alguien","médico","sangrado"],
  "doctors": {}
}'::jsonb;
