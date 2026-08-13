-- ============================================================
-- ESTADO OPERATIVO DE LA CLÍNICA — un hecho del día, no configuración.
-- Aplicada en producción: 2026-08-13.
--
-- Una paciente preguntó "¿Está abierta Algia para el control?" y el agente
-- contestó "Sí, Algia está abierta, atiende hoy hasta las 6:00 PM". Algia NO
-- estaba operando: había contingencia por el sismo.
--
-- El agente lo dedujo de `working_hours`, que dice a qué hora ABRE cuando abre
-- — no si HOY está abierta. Son dos preguntas distintas y el sistema solo sabía
-- responder la primera. Un horario configurado nunca puede sostener la
-- afirmación "estamos atendiendo".
-- ============================================================

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS operational_status TEXT NOT NULL DEFAULT 'operando'
    CHECK (operational_status IN ('operando', 'contingencia', 'cerrado')),
  ADD COLUMN IF NOT EXISTS operational_status_message TEXT,
  ADD COLUMN IF NOT EXISTS operational_status_since TIMESTAMPTZ;

COMMENT ON COLUMN public.clinics.operational_status IS
  'operando = atención normal · contingencia = no se agenda, se escala · cerrado = ídem. Cualquier valor != operando corta el agendamiento del agente.';
COMMENT ON COLUMN public.clinics.operational_status_message IS
  'Lo que se le dice a la paciente. Si está vacío se usa un texto genérico — pero NUNCA se afirma que la clínica atiende.';
