-- ============================================================
-- FESTIVOS NACIONALES. Aplicada en producción: 2026-08-13.
--
-- Omuwan no sabía que el 17 de agosto es festivo, así que el agente ofrecía
-- cita ese día. Lo descubrimos porque una paciente se lo dijo en el chat:
-- "el lunes es festivo".
--
-- POR QUÉ TABLA PROPIA Y NO FILAS EN blocked_dates:
-- un festivo NO es un bloqueo que cargó la clínica — es un hecho del calendario
-- del país, igual para todas. Meterlos ahí crearía una segunda fuente para la
-- misma pregunta y haría imposible distinguir "la clínica cerró" de "es feriado
-- nacional", que es justo lo que la secretaria necesita leer en el tooltip.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.national_holidays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL DEFAULT 'CO',
  holiday_date DATE NOT NULL,
  name         TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'verificado',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_code, holiday_date)
);

COMMENT ON TABLE public.national_holidays IS
  'Festivos nacionales por país. Hecho del calendario, NO configuración de la clínica: para eso está clinic_holiday_overrides.';

CREATE INDEX IF NOT EXISTS idx_national_holidays_lookup
  ON public.national_holidays(country_code, holiday_date);

-- Excepción por clínica: por defecto festivo = cerrado; una fila con works=true
-- significa "esta clínica SÍ atiende ese festivo". No todas cierran todos.
CREATE TABLE IF NOT EXISTS public.clinic_holiday_overrides (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  works        BOOLEAN NOT NULL DEFAULT true,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, holiday_date)
);

COMMENT ON TABLE public.clinic_holiday_overrides IS
  'Excepciones por clínica a los festivos nacionales. Fila con works=true = esa clínica atiende ese día.';

ALTER TABLE public.clinic_holiday_overrides ENABLE ROW LEVEL SECURITY;

-- get_user_clinic_id() (SECURITY DEFINER) y NO una subconsulta a clinic_users:
-- esa tabla tiene política auto-referencial y levanta 42P17 infinite recursion
-- al evaluarse como `authenticated`.
DROP POLICY IF EXISTS "clinic_holiday_overrides_select" ON public.clinic_holiday_overrides;
CREATE POLICY "clinic_holiday_overrides_select" ON public.clinic_holiday_overrides
  FOR SELECT USING (clinic_id = public.get_user_clinic_id());

-- Festivos de COLOMBIA 2026 desde agosto. Verificados contra dos fuentes
-- independientes: Wikipedia (Anexo:Días festivos en Colombia) y festivos.com.co.
INSERT INTO public.national_holidays (country_code, holiday_date, name, source) VALUES
  ('CO','2026-08-17','Asunción de la Virgen','verificado'),
  ('CO','2026-10-12','Día de la Diversidad Étnica y Cultural','verificado'),
  ('CO','2026-11-02','Todos los Santos','verificado'),
  ('CO','2026-11-16','Independencia de Cartagena','verificado'),
  ('CO','2026-12-08','Inmaculada Concepción','verificado'),
  ('CO','2026-12-25','Navidad','verificado')
ON CONFLICT (country_code, holiday_date) DO NOTHING;
