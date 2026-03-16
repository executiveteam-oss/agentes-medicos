-- ============================================================
-- Migración 00008: specialty TEXT → TEXT[] (múltiples especialidades)
-- Convierte datos existentes de texto a array de forma segura
-- ============================================================

-- Paso 1: Convertir clinics.specialty de TEXT a TEXT[]
-- Si ya es TEXT[], no hacer nada (idempotente)
DO $$
BEGIN
  -- Solo migrar si la columna actual es TEXT (no array)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clinics'
      AND column_name = 'specialty'
      AND data_type = 'text'
      AND udt_name = 'text'
  ) THEN
    -- Renombrar columna vieja
    ALTER TABLE clinics RENAME COLUMN specialty TO specialty_old;

    -- Crear columna nueva como TEXT[]
    ALTER TABLE clinics ADD COLUMN specialty TEXT[] DEFAULT '{}';

    -- Migrar datos existentes: TEXT → TEXT[] con un solo elemento
    UPDATE clinics
    SET specialty = ARRAY[specialty_old]
    WHERE specialty_old IS NOT NULL AND specialty_old != '';

    -- Eliminar columna vieja
    ALTER TABLE clinics DROP COLUMN specialty_old;
  END IF;
END $$;
