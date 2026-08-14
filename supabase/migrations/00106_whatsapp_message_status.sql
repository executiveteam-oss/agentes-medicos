-- ============================================================
-- Estado de ENTREGA de los mensajes que salen por WhatsApp.
--
-- POR QUÉ EXISTE: hasta el 2026-08-14 el webhook recibía los status updates de
-- Meta y los descartaba con un `console.log('...ignorando')`. La consecuencia
-- concreta: el 14/08 a las 12:59 se envió un resumen de prueba, Meta lo aceptó
-- (`sent:1`, sin error), nunca llegó al teléfono — y el estado que lo explicaba
-- entró por el webhook NUEVE SEGUNDOS después y se tiró a la basura.
--
-- "Aceptado por Meta" y "entregado al teléfono" son dos cosas distintas, y sin
-- esta tabla el sistema solo sabía la primera. Para un resumen diario que siete
-- médicos usan para saber a quién atienden, esa diferencia es la que importa.
--
-- CLAVE: el wamid. Es el id que devuelve Meta al aceptar el envío y el mismo que
-- viaja en los status updates, así que es lo único que permite cruzar "lo mandé"
-- con "llegó". Por eso quien envía tiene que persistirlo.
--
-- No reemplaza a `messages.delivery_status`: esa columna sigue siendo la fuente
-- para los mensajes que tienen fila en `messages` (conversaciones con
-- pacientes), y el webhook la sigue actualizando. Esta tabla cubre TODO lo que
-- sale —incluidos templates a médicos y reportes al staff, que no tienen
-- conversación— y es la única que puede responder "¿se entregó?" para ellos.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_message_status (
  -- El wamid de Meta. PK: un mensaje tiene un solo estado vigente.
  wamid           text PRIMARY KEY,
  clinic_id       uuid REFERENCES public.clinics(id) ON DELETE CASCADE,

  -- sent → delivered → read, o failed. Se guarda el ÚLTIMO conocido.
  status          text NOT NULL,
  -- Código y texto de Meta cuando status='failed' (ej. 131030, 132015).
  error_code      integer,
  error_title     text,
  error_message   text,

  -- Últimos 4 dígitos del destinatario. NUNCA el número completo: es un dato
  -- personal y el repositorio es público (Ley 1581/2012).
  recipient_tail  text,

  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Para "¿qué falló hoy?" sin escanear la tabla entera.
CREATE INDEX IF NOT EXISTS idx_wa_status_fallidos
  ON public.whatsapp_message_status (clinic_id, updated_at DESC)
  WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_wa_status_updated
  ON public.whatsapp_message_status (updated_at DESC);

-- El trigger de updated_at ya existe como función desde la migración 00105.
DROP TRIGGER IF EXISTS trg_wa_status_updated_at ON public.whatsapp_message_status;
CREATE TRIGGER trg_wa_status_updated_at
  BEFORE UPDATE ON public.whatsapp_message_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: la escribe el webhook con service_role (saltea RLS). Para lectura desde
-- el dashboard se resuelve la clínica con get_user_clinic_id(), que es
-- SECURITY DEFINER y corta la recursión de políticas — el patrón obligatorio
-- de este esquema.
ALTER TABLE public.whatsapp_message_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_status_select_por_clinica" ON public.whatsapp_message_status;
CREATE POLICY "wa_status_select_por_clinica"
  ON public.whatsapp_message_status FOR SELECT
  TO authenticated
  USING (clinic_id = public.get_user_clinic_id());

COMMENT ON TABLE public.whatsapp_message_status IS
  'Último estado de entrega por wamid. Meta lo manda por webhook; antes se descartaba.';
