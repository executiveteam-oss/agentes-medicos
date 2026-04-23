-- Migración 00053: Fechas bloqueadas por doctor o clínica
-- doctor_id NULL = bloqueo de toda la clínica (aplica a todos los doctores)
-- doctor_id con valor = bloqueo solo para ese doctor

CREATE TABLE IF NOT EXISTS public.blocked_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_blocked_dates_clinic_dates ON public.blocked_dates(clinic_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_blocked_dates_doctor ON public.blocked_dates(doctor_id) WHERE doctor_id IS NOT NULL;

ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blocked_dates_select" ON public.blocked_dates FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true));

CREATE POLICY "blocked_dates_insert" ON public.blocked_dates FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true));

CREATE POLICY "blocked_dates_delete" ON public.blocked_dates FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true));
