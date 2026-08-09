-- ============================================================
-- La orden médica que manda la paciente tiene que quedar atada a la CITA que la
-- necesita. Aplicada en producción: 2026-08-09.
--
-- Sin esto, `conversation_media` solo apuntaba a la conversación: el archivo
-- llegaba a la bandeja de autorizaciones pero nadie podía saber de qué cita era
-- —ni a mano—, así que el ciclo "pedir orden → recibirla → radicar" no cerraba.
--
-- Nullable a propósito: si al recibir el archivo hay VARIAS citas esperando
-- documentos, queda sin atar y la secretaria elige. Adivinar sería peor que no
-- atar: una orden colgada de la cita equivocada se radica mal.
-- ============================================================

ALTER TABLE public.conversation_media
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_media_appointment
  ON public.conversation_media(appointment_id) WHERE appointment_id IS NOT NULL;

COMMENT ON COLUMN public.conversation_media.appointment_id IS
  'Cita a la que pertenece el documento. Se resuelve sola cuando hay exactamente una cita con documents_requested=true y documents_received=false; NULL si hay ambigüedad.';
