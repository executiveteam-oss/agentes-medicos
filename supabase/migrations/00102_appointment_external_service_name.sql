-- ============================================================
-- El servicio que iSalud dice que es la cita, en su propia columna.
-- Aplicada en producción: 2026-08-13.
--
-- El dato venía en el payload del sync desde siempre, enterrado en
-- external_data.procedimiento, y el panel mostraba "Sin especificar". La
-- secretaria tenía que salir de Omuwan y abrir iSalud para saber qué le iban a
-- hacer a la paciente que tenía enfrente.
--
-- Va en columna propia y NO se lee de external_data en la UI por dos razones:
-- external_data se pisa entero en cada sync (es el payload crudo), y para las
-- citas donde iSalud no manda procedimiento el valor sale del histórico, que es
-- otra tabla. La columna es la respuesta única a "¿qué servicio es esta cita?".
--
-- NO reemplaza a consultation_type_id: esa fila lleva precio, duración y reglas,
-- y solo se escribe cuando el match es inequívoco. Esta columna es el TEXTO, que
-- se muestra siempre que exista.
-- ============================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS external_service_name TEXT;

COMMENT ON COLUMN public.appointments.external_service_name IS
  'Nombre del servicio/procedimiento tal como lo manda el HIS externo. Se muestra cuando consultation_type_id es NULL. NULL = el HIS no lo trae.';

CREATE INDEX IF NOT EXISTS idx_appointments_external_service
  ON public.appointments(clinic_id, external_service_name)
  WHERE external_service_name IS NOT NULL;
