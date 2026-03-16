-- ============================================================
-- Migración 00010: Facturación EPS — campos de radicación,
-- autorización, copago y glosas
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Campos EPS en citas
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS eps_name TEXT;
-- Nombre de la EPS: 'Sura', 'Compensar', 'Nueva EPS', 'Sanitas'

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS authorization_code TEXT;
-- Código de autorización EPS (ej. "AUTH-84729301")

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS clinic_value INTEGER DEFAULT 0;
-- Valor cobrado por la clínica en COP

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS eps_value INTEGER DEFAULT 0;
-- Valor que paga la EPS (85-90% del clinic_value)

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_copago INTEGER DEFAULT 0;
-- Cuota moderadora que paga el paciente

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS invoice_radication_date DATE;
-- Fecha en que la clínica radicó la factura ante la EPS

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS glosa_value INTEGER DEFAULT 0;
-- Monto objetado por la EPS (glosa)

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS glosa_reason TEXT;
-- Razón de la glosa: "Tarifa superior a la pactada", "Falta autorización previa", etc.

-- Nuevos valores de invoice_status para EPS:
-- 'pendiente'   → sin radicar
-- 'emitida'     → radicada, sin respuesta aún
-- 'en_tramite'  → radicada hace <20 días hábiles
-- 'pagada'      → EPS pagó en su totalidad
-- 'glosada'     → EPS objetó parte de la factura
-- 'vencida'     → >60 días sin pago, EPS incumplió término legal
-- (No se usa ENUM para flexibilidad, solo TEXT con convención)

COMMENT ON COLUMN appointments.eps_name IS 'EPS que cubre al paciente (solo si payment_type = EPS)';
COMMENT ON COLUMN appointments.authorization_code IS 'Código de autorización emitido por la EPS';
COMMENT ON COLUMN appointments.clinic_value IS 'Valor total cobrado por la clínica (COP)';
COMMENT ON COLUMN appointments.eps_value IS 'Valor que reconoce/paga la EPS (COP)';
COMMENT ON COLUMN appointments.patient_copago IS 'Cuota moderadora pagada por el paciente (COP)';
COMMENT ON COLUMN appointments.invoice_radication_date IS 'Fecha de radicación de factura ante la EPS';
COMMENT ON COLUMN appointments.glosa_value IS 'Monto objetado (glosa) por la EPS (COP)';
COMMENT ON COLUMN appointments.glosa_reason IS 'Motivo de la glosa por parte de la EPS';
