-- Migración 00060: Franjas horarias preferidas por tipo de consulta
-- Permite que un tipo de consulta tenga horarios específicos dentro del horario del doctor.

CREATE TABLE IF NOT EXISTS public.consultation_type_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_type_id uuid NOT NULL REFERENCES public.consultation_types(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_time_range CHECK (end_time > start_time),
  UNIQUE(consultation_type_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_ct_schedules_type ON public.consultation_type_schedules(consultation_type_id);

ALTER TABLE public.consultation_type_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ct_schedules_select" ON public.consultation_type_schedules FOR SELECT TO authenticated
  USING (consultation_type_id IN (
    SELECT id FROM public.consultation_types WHERE clinic_id IN (
      SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true
    )
  ));

CREATE POLICY "ct_schedules_insert" ON public.consultation_type_schedules FOR INSERT TO authenticated
  WITH CHECK (consultation_type_id IN (
    SELECT id FROM public.consultation_types WHERE clinic_id IN (
      SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true
    )
  ));

CREATE POLICY "ct_schedules_delete" ON public.consultation_type_schedules FOR DELETE TO authenticated
  USING (consultation_type_id IN (
    SELECT id FROM public.consultation_types WHERE clinic_id IN (
      SELECT clinic_id FROM public.clinic_users WHERE auth_user_id = auth.uid() AND is_active = true
    )
  ));
