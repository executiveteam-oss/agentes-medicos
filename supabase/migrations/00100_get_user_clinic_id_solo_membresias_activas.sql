-- ============================================================
-- get_user_clinic_id(): filtrar membresías REVOCADAS.
-- Aplicada en producción: 2026-08-05
--
-- La versión anterior era:
--   SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid() LIMIT 1;
--
-- Sin filtro de is_active y sin ORDER BY. Con más de una fila devolvía una
-- cualquiera — y en producción devolvía la REVOCADA:
--
--   demo@omuwan.co → Centro Médico Bolívar (activa) | Consultorio Médico Demo (revocada)
--   la función devolvía la revocada.
--
-- Con la migración 00099 las políticas de conversations/messages pasaron a
-- resolver la clínica con esta función, así que ese usuario habría leído una
-- clínica de la que fue dado de baja, y no habría visto la suya. Cross-tenant
-- por una membresía muerta.
--
-- Se descubrió porque el conteo de control ("¿cuántos usuarios están en más de
-- una clínica?") se había hecho filtrando is_active = true — justo el filtro que
-- esconde este caso. Sin ese filtro: 1 usuario, en producción, hoy.
--
-- El cambio es ESTRICTAMENTE RESTRICTIVO: solo puede quitar acceso, nunca
-- agregarlo. Un usuario desactivado deja de resolver clínica, que es lo correcto.
--
-- ⚠ SIGUE SIENDO UN PARCHE. Con DOS membresías ACTIVAS el LIMIT 1 elige una y
-- calla. Hoy nadie está en dos clínicas activas; deja de ser cierto con el
-- segundo cliente. Ver "Un usuario, una clínica" en CLAUDE.md — es deuda a
-- resolver ANTES de vender, no después.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_clinic_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT clinic_id FROM public.clinic_users
  WHERE auth_user_id = auth.uid()
    AND is_active = true
  ORDER BY created_at
  LIMIT 1;
$function$;
