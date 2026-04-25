-- ============================================================
-- Migración 00062: Eliminar tablas y columnas financieras
-- Cartera, facturación, glosas → STRADmed (producto separado)
-- ============================================================

-- 1. Drop tablas financieras
DROP TABLE IF EXISTS cartera CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;

-- 2. Drop columnas financieras de appointments (conserva payment_type y eps_name)
ALTER TABLE appointments DROP COLUMN IF EXISTS invoice_status;
ALTER TABLE appointments DROP COLUMN IF EXISTS outstanding_balance;
ALTER TABLE appointments DROP COLUMN IF EXISTS authorization_code;
ALTER TABLE appointments DROP COLUMN IF EXISTS clinic_value;
ALTER TABLE appointments DROP COLUMN IF EXISTS eps_value;
ALTER TABLE appointments DROP COLUMN IF EXISTS patient_copago;
ALTER TABLE appointments DROP COLUMN IF EXISTS invoice_radication_date;
ALTER TABLE appointments DROP COLUMN IF EXISTS glosa_value;
ALTER TABLE appointments DROP COLUMN IF EXISTS glosa_reason;
ALTER TABLE appointments DROP COLUMN IF EXISTS invoice_number;
ALTER TABLE appointments DROP COLUMN IF EXISTS invoice_date;
ALTER TABLE appointments DROP COLUMN IF EXISTS invoice_amount;
ALTER TABLE appointments DROP COLUMN IF EXISTS invoice_observations;
ALTER TABLE appointments DROP COLUMN IF EXISTS collection_status;
ALTER TABLE appointments DROP COLUMN IF EXISTS glosa_notification_date;
ALTER TABLE appointments DROP COLUMN IF EXISTS glosa_response_date;
ALTER TABLE appointments DROP COLUMN IF EXISTS glosa_status;
ALTER TABLE appointments DROP COLUMN IF EXISTS glosa_notes;

-- 3. Drop columna daily_goal de clinics
ALTER TABLE clinics DROP COLUMN IF EXISTS daily_goal_appointments;

-- 4. Drop índices financieros (los que sobrevivieron al CASCADE)
DROP INDEX IF EXISTS idx_cartera_clinic;
DROP INDEX IF EXISTS idx_cartera_overdue;
DROP INDEX IF EXISTS idx_appointments_payment;
DROP INDEX IF EXISTS idx_appointments_invoice;
DROP INDEX IF EXISTS idx_invoices_clinic;
DROP INDEX IF EXISTS idx_invoices_patient;
DROP INDEX IF EXISTS idx_invoices_number;
DROP INDEX IF EXISTS idx_appointments_glosa_status;
