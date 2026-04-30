# RLS Recursion Backlog

**Fecha:** 2026-04-30
**Estado:** Documentado, sin impacto funcional actual

## Problema

Varias tablas tienen RLS policies que hacen `SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()`. La tabla `clinic_users` tiene su propia RLS policy que tambien referencia `clinic_users`, causando **infinite recursion** cuando se consulta desde un authenticated client (browser).

## Tablas afectadas

| Tabla | Migracion | Acceso browser? | Rota hoy? |
|---|---|---|---|
| `blocked_dates` | 00053 | No — solo supabaseAdmin | No |
| `specialty_notifications` | 00056 | No — solo supabaseAdmin | No |
| `consultation_types` | 00023 | No — solo supabaseAdmin | No |
| `consultation_type_schedules` | 00060 | No — solo supabaseAdmin | No |
| `api_usage` | 00009 | No — solo supabaseAdmin | No |
| `pending_contacts` | 00066 | **Arreglada en 00067** | No (fixed) |

## Fix aplicado a pending_contacts (migracion 00067)

```sql
CREATE OR REPLACE FUNCTION public.get_user_clinic_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
  SELECT clinic_id FROM public.clinic_users
  WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_clinic_id() TO authenticated;

-- Policy usa la funcion en vez de subquery directa
CREATE POLICY "..." ON pending_contacts
  USING (clinic_id = public.get_user_clinic_id());
```

La funcion `SECURITY DEFINER` ejecuta con privilegios del creador (postgres), bypaseando RLS de `clinic_users` dentro de la funcion. Sin recursion.

## Recomendacion

Si en el futuro alguna de las 5 tablas restantes necesita acceso desde browser client (ej: Realtime subscription, o query directa sin server action):

1. Reusar `public.get_user_clinic_id()` (ya existe)
2. Reemplazar la policy con `USING (clinic_id = public.get_user_clinic_id())`
3. No hace falta nueva migracion por la funcion — solo DROP + CREATE POLICY

**No aplicar el fix preventivamente** — las tablas funcionan correctamente con supabaseAdmin y cambiar policies innecesariamente agrega riesgo sin beneficio.

## Multi-clinic

La funcion usa `LIMIT 1`. Verificado 2026-04-30: ningun usuario esta en multiples clinicas (0 en local, 0 en produccion). Si se implementa multi-clinic en el futuro, esta funcion necesita revision.
