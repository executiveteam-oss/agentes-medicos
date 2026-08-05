-- 00098 — Cerrar el EXECUTE público sobre dos funciones SECURITY DEFINER que el
-- advisor de seguridad marcó como ejecutables por anon vía /rest/v1/rpc/*.
--
-- El default de Postgres concede EXECUTE a PUBLIC (que incluye anon), por eso
-- revocar "solo a anon" no basta: se revoca de PUBLIC y se re-concede a los
-- roles que sí las usan.
--
-- Verificado en el código: get_user_clinic_id() NO se llama por RPC desde el
-- frontend (solo se usa dentro de políticas RLS); increment_patient_appointments
-- solo la llama el server con service_role (executor.ts) — era un camino de
-- ESCRITURA sin autenticar con la publishable key.

-- Usada dentro de políticas RLS → authenticated la necesita.
REVOKE EXECUTE ON FUNCTION public.get_user_clinic_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_clinic_id() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_user_clinic_id() TO authenticated, service_role;

-- Escribe. Solo la llama el server (service_role) → exclusiva de service_role.
REVOKE EXECUTE ON FUNCTION public.increment_patient_appointments(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_patient_appointments(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_patient_appointments(uuid) TO service_role;
