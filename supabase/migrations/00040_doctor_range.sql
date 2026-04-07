-- Migración 00040: Agregar doctor_range y preferred_plan_price a clinics
-- doctor_range: rango seleccionado en registro ("1", "2-3", "4-6", "7-10")
-- preferred_plan_price: precio mensual Core en COP según rango

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS doctor_range TEXT,
  ADD COLUMN IF NOT EXISTS preferred_plan_price INTEGER;
