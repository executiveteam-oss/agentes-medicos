-- Migración 00051: Campo EPS/entidad en tipos de consulta
-- Almacena el nombre del convenio/EPS asociado al tipo de consulta

ALTER TABLE public.consultation_types
ADD COLUMN IF NOT EXISTS eps_name text;

COMMENT ON COLUMN public.consultation_types.eps_name IS 'Nombre del convenio/EPS/aseguradora asociado (ej. "Sura", "Allianz Seguros de Vida")';
