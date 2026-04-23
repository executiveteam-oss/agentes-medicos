-- Migración 00054: Motivo para paciente en blocked_dates + razón de cancelación en appointments
ALTER TABLE public.blocked_dates ADD COLUMN IF NOT EXISTS patient_reason text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancellation_reason text;
