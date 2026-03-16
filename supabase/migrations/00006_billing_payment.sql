-- ============================================================
-- Migración 00006: Facturación, cartera y meta diaria
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- CITAS: tipo de pago y facturación
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'Particular';
-- Valores: 'EPS', 'Particular', 'Póliza', 'ARL', 'SOAT'

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS invoice_status TEXT DEFAULT 'pendiente';
-- Valores: 'pendiente', 'emitida', 'vencida'

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS outstanding_balance INTEGER DEFAULT 0;
-- Saldo pendiente en COP

-- CLÍNICAS: meta diaria (punto de equilibrio)
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS daily_goal_appointments INTEGER DEFAULT 8;

-- TABLA CARTERA
CREATE TABLE IF NOT EXISTS cartera (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL,
    days_overdue INTEGER DEFAULT 0,
    treatment TEXT,
    payment_type TEXT NOT NULL DEFAULT 'Particular',
    collection_attempts INTEGER DEFAULT 0,
    last_collection_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pendiente',   -- pendiente, pagado, castigado
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cartera ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver cartera de mi clínica"
    ON cartera FOR SELECT TO authenticated
    USING (clinic_id IN (
        SELECT clinic_id FROM doctors WHERE email = auth.jwt() ->> 'email'
    ));

CREATE INDEX IF NOT EXISTS idx_cartera_clinic ON cartera(clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_cartera_overdue ON cartera(days_overdue, status);
CREATE INDEX IF NOT EXISTS idx_appointments_payment ON appointments(clinic_id, payment_type, starts_at);
