-- ============================================================
-- Migración: Habilitar Supabase Realtime en tabla appointments
-- Permite que el dashboard se actualice en tiempo real cuando
-- el agente de WhatsApp crea, cancela o reagenda citas
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
