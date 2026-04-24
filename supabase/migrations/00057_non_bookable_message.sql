-- Migración 00057: Mensaje custom cuando un tipo de consulta no es agendable por WhatsApp
ALTER TABLE public.consultation_types ADD COLUMN IF NOT EXISTS non_bookable_message text;
