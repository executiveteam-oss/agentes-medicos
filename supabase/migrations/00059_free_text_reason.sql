ALTER TABLE public.consultation_types ADD COLUMN IF NOT EXISTS requires_free_text_reason boolean NOT NULL DEFAULT false;
ALTER TABLE public.consultation_types ADD COLUMN IF NOT EXISTS free_text_reason_prompt text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS free_text_reason text;
