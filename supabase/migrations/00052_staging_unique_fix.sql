-- Migración 00052: Fix UNIQUE constraint en isalud_import_staging
-- Convenios con mismo NIT pero distinto nombre abreviado (ej. 4 Allianz)
-- colisionaban y solo se guardaban los productos del primero.

-- Drop por nombre exacto generado por Postgres (truncado a 63 chars)
ALTER TABLE public.isalud_import_staging
  DROP CONSTRAINT IF EXISTS isalud_import_staging_clinic_id_convenio_nit_producto_nombr_key;

-- Drop por nombre explícito (si se creó manualmente antes)
ALTER TABLE public.isalud_import_staging
  DROP CONSTRAINT IF EXISTS isalud_import_staging_clinic_id_convenio_nit_producto_nombre_key;

ALTER TABLE public.isalud_import_staging
  DROP CONSTRAINT IF EXISTS isalud_import_staging_unique;

ALTER TABLE public.isalud_import_staging
  ADD CONSTRAINT isalud_import_staging_unique
  UNIQUE (clinic_id, convenio_nit, convenio_nombre_abreviado, producto_nombre);
