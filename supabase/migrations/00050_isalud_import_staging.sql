-- ============================================================
-- Migración 00050: Tabla staging para importar convenios desde iSalud
--
-- Buffer temporal de onboarding: el agente vuelca productos
-- de iSalud aquí, Lady selecciona cuáles, y al confirmar se
-- crean los consultation_types y se borra el staging.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.isalud_import_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE NOT NULL,
  convenio_nit text,
  convenio_nombre text NOT NULL,
  convenio_nombre_abreviado text,
  producto_nombre text NOT NULL,
  tarifa integer DEFAULT 0,
  duracion_minutos integer,
  agendable_web boolean DEFAULT false,
  opcion_detalle text,
  imported_at timestamptz DEFAULT now(),
  UNIQUE(clinic_id, convenio_nit, producto_nombre)
);

CREATE INDEX IF NOT EXISTS idx_isalud_staging_clinic ON public.isalud_import_staging(clinic_id);

-- RLS: solo usuarios de la clínica con permiso de escritura en settings
ALTER TABLE public.isalud_import_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staging_select_own_clinic"
  ON public.isalud_import_staging FOR SELECT TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM public.clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY "staging_insert_own_clinic"
  ON public.isalud_import_staging FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (
    SELECT clinic_id FROM public.clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY "staging_update_own_clinic"
  ON public.isalud_import_staging FOR UPDATE TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM public.clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY "staging_delete_own_clinic"
  ON public.isalud_import_staging FOR DELETE TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM public.clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));
