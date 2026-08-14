-- ============================================================
-- Trigger de updated_at en appointments.
--
-- POR QUÉ: sin esto, un UPDATE que no seteaba `updated_at` a mano dejaba la
-- fila con el timestamp de la escritura ANTERIOR. Es lo que mantuvo invisible
-- ~50 días el bug del sync de iSalud: el sync pisaba el status de citas que el
-- staff había cancelado, pero como no tocaba `updated_at`, las filas conservaban
-- la hora de la cancelación y se veían intactas. Al mirarlas, el timestamp
-- decía "nadie tocó esto desde que se canceló" — y era falso.
--
-- Un campo de auditoría que solo se actualiza cuando el que escribe se acuerda
-- de actualizarlo no es un campo de auditoría. Con el trigger, cualquier
-- escritura futura queda fechada aunque el código la omita.
--
-- COMPATIBILIDAD: los UPDATE que ya mandan `updated_at: new Date()` siguen
-- funcionando — el trigger lo pisa con now(), que es el mismo instante. Se
-- verificó que ningún camino del código escriba un updated_at con fecha
-- distinta de "ahora" (no hay backdating que esto pudiera romper).
--
-- NO se hace backfill: las filas viejas conservan su updated_at actual. Cambiarlo
-- borraría la evidencia de cuándo se escribieron de verdad, que es justamente
-- el dato que sirvió para reconstruir el incidente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
