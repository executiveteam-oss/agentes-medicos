-- Migración 00056: Teléfono de notificación por especialidad
-- Permite configurar a qué secretaria va la notificación según la especialidad de la cita.

CREATE TABLE IF NOT EXISTS public.specialty_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  specialty_name text NOT NULL,
  notification_phone text NOT NULL,
  contact_name text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(clinic_id, specialty_name)
);

CREATE INDEX IF NOT EXISTS idx_specialty_notifications_clinic ON public.specialty_notifications(clinic_id);

ALTER TABLE public.specialty_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "specialty_notifications_select" ON public.specialty_notifications FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true));
CREATE POLICY "specialty_notifications_insert" ON public.specialty_notifications FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true));
CREATE POLICY "specialty_notifications_update" ON public.specialty_notifications FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true));
CREATE POLICY "specialty_notifications_delete" ON public.specialty_notifications FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true));
