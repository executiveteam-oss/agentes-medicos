-- ============================================================
-- Realtime no entregaba filas de conversations/messages.
-- Aplicada en producción: 2026-08-05
--
-- SÍNTOMA: el canal decía SUBSCRIBED y no llegaba ni una fila. Había que
-- recargar la página para ver un mensaje nuevo.
--
-- CAUSA: las políticas SELECT resolvían la clínica por subconsulta a
-- clinic_users (las nuevas) y a doctors (las legacy). ESAS DOS TABLAS tienen
-- políticas AUTO-REFERENCIALES:
--
--   clinic_users → USING (clinic_id IN (SELECT clinic_id FROM clinic_users ...))
--   doctors      → USING (clinic_id IN (SELECT clinic_id FROM doctors ...))
--
-- Evaluar eso como `authenticated` levanta 42P17 infinite recursion. Una
-- política que LANZA EXCEPCIÓN se ve exactamente igual que "esta fila no es
-- visible": Realtime no entrega nada y no hay error en el cliente.
--
-- Las políticas permisivas se evalúan TODAS y se combinan con OR, así que
-- alcanzaba con que una de las dos explotara para tumbar la consulta entera.
--
-- POR QUÉ EL DASHBOARD SIEMPRE ANDUVO: lee con service_role, que saltea RLS.
-- El único camino que evalúa estas políticas es el navegador — o sea, Realtime.
--
-- Estaba documentado desde 2026-04-30 en docs/RLS_RECURSION_BACKLOG.md, que
-- anticipaba textualmente el caso "Realtime subscription". conversations y
-- messages no estaban en su lista porque en abril no se leían del navegador.
--
-- FIX: patrón ya establecido (migración 00067) — resolver la clínica con
-- public.get_user_clinic_id(), SECURITY DEFINER, que adentro corre como
-- postgres y no dispara la RLS de clinic_users.
--
-- No amplía el alcance: mismo "solo mi clínica", sin recursión.
-- Verificado ANTES de aplicar, contra el padrón completo:
--   · 8 auth.users, los 8 con fila activa en clinic_users → 0 dependían de la
--     política legacy por email de doctors; quitarla no le saca acceso a nadie.
-- Verificado DESPUÉS: una Coordinadora de la clínica piloto ve 10 de 41
-- conversaciones y 215 de 532 mensajes → el aislamiento por tenant sigue firme.
-- ============================================================

DROP POLICY IF EXISTS "Ver conversaciones de mi clínica" ON public.conversations;
DROP POLICY IF EXISTS conversations_select_clinic_users ON public.conversations;

CREATE POLICY conversations_select_clinic_users ON public.conversations
  FOR SELECT
  USING (clinic_id = public.get_user_clinic_id());

DROP POLICY IF EXISTS "Ver mensajes de mi clínica" ON public.messages;
DROP POLICY IF EXISTS messages_select_clinic_users ON public.messages;

CREATE POLICY messages_select_clinic_users ON public.messages
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT c.id FROM public.conversations c
      WHERE c.clinic_id = public.get_user_clinic_id()
    )
  );

-- messages estaba en REPLICA IDENTITY default (solo PK) mientras conversations
-- ya estaba en FULL — asimetría no intencional. Cambio de metadatos, sin
-- reescritura de tabla.
ALTER TABLE public.messages REPLICA IDENTITY FULL;
