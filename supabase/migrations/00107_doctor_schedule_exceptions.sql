-- ============================================================
-- Excepción de horario por fecha: "este martes atiendo distinto".
--
-- POR QUÉ UNA TABLA NUEVA Y NO UNA COLUMNA EN blocked_dates: `blocked_dates`
-- significa inequívocamente "no se atiende", y hay código que la lee así —
-- bulk-cancel toma sus filas para CANCELAR Y NOTIFICAR pacientes. Meterle
-- "atiende, pero distinto" haría que ese flujo cancele citas de un día que sí
-- se trabaja. Son dos preguntas distintas y viven separadas.
--
-- QUÉ NO ES: una excepción NUNCA abre un día cerrado. Cambia las HORAS de un
-- día que ya se atiende. "No atiende" se sigue diciendo con blocked_dates, y si
-- alguien carga una excepción sobre un festivo o unas vacaciones, el día sigue
-- cerrado (la precedencia vive en day-availability.ts).
--
-- Una excepción SIN franjas no existe: sería "no atiende" dicho en el lugar
-- equivocado. Lo garantiza el CHECK de abajo, no una validación de la UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.doctor_schedule_exceptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id     uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,

  -- UNA fecha. Los rangos, la recurrencia y el "aplicar a varios médicos"
  -- quedaron fuera de alcance a propósito.
  exception_date date NOT NULL,

  -- [{"start":"10:00","end":"13:00"}, ...] — mismo formato que los `blocks` de
  -- working_hours, para que la UI reuse el editor que la secretaria ya conoce.
  blocks        jsonb NOT NULL,

  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Un médico tiene UNA excepción por fecha. Cargar otra es editar la que hay.
  CONSTRAINT doctor_schedule_exceptions_unicas UNIQUE (doctor_id, exception_date),

  -- Sin franjas no es una excepción. Ver el encabezado.
  CONSTRAINT doctor_schedule_exceptions_con_franjas
    CHECK (jsonb_typeof(blocks) = 'array' AND jsonb_array_length(blocks) > 0)
);

-- El acceso siempre es "las excepciones de este médico en este rango de fechas".
CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_medico_fecha
  ON public.doctor_schedule_exceptions (doctor_id, exception_date);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_clinica_fecha
  ON public.doctor_schedule_exceptions (clinic_id, exception_date);

DROP TRIGGER IF EXISTS trg_schedule_exceptions_updated_at ON public.doctor_schedule_exceptions;
CREATE TRIGGER trg_schedule_exceptions_updated_at
  BEFORE UPDATE ON public.doctor_schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: se escribe con service_role desde las server actions. La lectura resuelve
-- la clínica con get_user_clinic_id() (SECURITY DEFINER) — obligatorio en este
-- esquema: resolverla por subconsulta a clinic_users levanta 42P17 recursión.
ALTER TABLE public.doctor_schedule_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_exceptions_select_por_clinica" ON public.doctor_schedule_exceptions;
CREATE POLICY "schedule_exceptions_select_por_clinica"
  ON public.doctor_schedule_exceptions FOR SELECT
  TO authenticated
  USING (clinic_id = public.get_user_clinic_id());

COMMENT ON TABLE public.doctor_schedule_exceptions IS
  'Horario distinto para UNA fecha puntual. Cambia las horas de un día que se atiende; nunca abre un día cerrado.';
