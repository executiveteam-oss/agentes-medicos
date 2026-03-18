-- ============================================================
-- Tabla standalone de facturas manuales
-- Permite crear facturas sin cita asociada
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    invoice_amount INTEGER NOT NULL DEFAULT 0,
    payment_type TEXT NOT NULL DEFAULT 'Particular',
    eps_name TEXT,
    collection_status TEXT DEFAULT 'en_tramite'
        CHECK (collection_status IN ('pendiente', 'en_tramite', 'cobrada', 'glosada', 'vencida')),
    observations TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_invoices_clinic ON invoices(clinic_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(clinic_id, invoice_number);
