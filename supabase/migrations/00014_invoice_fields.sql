-- ============================================================
-- Campos de facturación real en appointments
-- invoice_number: número de la factura del software externo
-- invoice_date: fecha de emisión
-- invoice_amount: valor facturado (puede diferir del precio consulta)
-- invoice_observations: notas libres
-- collection_status: estado del cobro (en_tramite, cobrada, glosada, vencida)
-- ============================================================

-- Número de factura del software externo (Siigo, Alegra, etc.)
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;

-- Fecha de emisión de la factura
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS invoice_date DATE;

-- Valor facturado (puede diferir del precio base de consulta)
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS invoice_amount INTEGER;

-- Observaciones de facturación
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS invoice_observations TEXT;

-- Estado del cobro
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS collection_status TEXT DEFAULT 'pendiente'
    CHECK (collection_status IN ('pendiente', 'en_tramite', 'cobrada', 'glosada', 'vencida'));

-- Índice para buscar citas sin facturar rápidamente
CREATE INDEX IF NOT EXISTS idx_appointments_invoice
  ON appointments(clinic_id, invoice_number, collection_status);
