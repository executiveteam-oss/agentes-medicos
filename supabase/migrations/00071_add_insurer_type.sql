-- ============================================================
-- Migración 00071: insurer_type en consultation_types
--
-- Sub-fase A del feature "3 categorías de pago".
-- Permite distinguir convenios EPS vs Medicina Prepagada.
--
-- Detonante: Lady (Algia) reportó que el agente confunde prepagada
-- con EPS. Sus 18 convenios importados de iSalud son todos prepagadas
-- pero hoy no se distinguen.
--
-- Sub-fase B (próxima semana): rename eps_name → insurer_name,
-- agregar columnas a patients/appointments, UI completa.
-- ============================================================

-- 1. Columna de clasificación: EPS vs Prepagada
ALTER TABLE consultation_types
  ADD COLUMN insurer_type TEXT
    CHECK (insurer_type IN ('EPS', 'Prepagada'));

-- 2. Flag para que el sync de iSalud (futuro UPDATE) no pisotee
--    clasificaciones manuales hechas por staff
ALTER TABLE consultation_types
  ADD COLUMN insurer_type_set_by_staff BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Índice parcial para el filtro del tool check_eps_convenio
--    Solo indexa filas con eps_name no nulo (donde el filtro tiene sentido)
CREATE INDEX idx_consultation_types_clinic_insurer
  ON consultation_types(clinic_id, insurer_type)
  WHERE eps_name IS NOT NULL;

-- 4. Documentación in-DB
COMMENT ON COLUMN consultation_types.insurer_type IS
  'EPS = régimen contributivo Ley 100. Prepagada = medicina prepagada voluntaria. NULL = sin clasificar (staff debe categorizar desde dashboard).';

COMMENT ON COLUMN consultation_types.insurer_type_set_by_staff IS
  'TRUE si staff clasificó manualmente desde dashboard. Sync de iSalud (futuro UPDATE) debe respetar este flag para no sobrescribir.';

-- ============================================================
-- Notas de no-cambios en esta migración:
--
-- - consultation_types.eps_name NO se renombra (rename queda para Sub-fase B)
-- - patients.eps_name, appointments.eps_name NO se tocan (Sub-fase B)
-- - appointments.payment_type NO se cambia su CHECK constraint
--   (en Sub-fase B agregamos 'Prepagada' formal en SQL CHECK;
--   por ahora el valor 'Prepagada' se permite vía validación Zod)
-- - Backfill: insurer_type queda en NULL para todas las filas existentes.
--   Lady categorizará manualmente desde dashboard.
-- ============================================================
