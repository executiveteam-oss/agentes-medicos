# RLS Recursion Backlog

**Creado:** 2026-04-30 · **Actualizado:** 2026-08-05 (inventario releído de la DB, no del doc)

## Problema

Casi todas las políticas RLS de este esquema resuelven la clínica por subconsulta a
`clinic_users` o a `doctors`. **Esas dos tablas tienen políticas auto-referenciales:**

```sql
-- clinic_users → "Usuarios de mi clínica"
clinic_id IN (SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid() AND is_active)

-- doctors → "Ver doctores de mi clínica"
clinic_id IN (SELECT clinic_id FROM doctors WHERE email = auth.jwt() ->> 'email')
```

Evaluarlas como `authenticated` levanta `42P17: infinite recursion detected in policy`.

**Lo que lo hace traicionero:** una política que lanza excepción **se ve igual que "no hay filas
visibles"**. El cliente no recibe error; simplemente no llega nada. Y con `service_role` (que es
como lee casi todo el dashboard) no se nota nunca, porque saltea RLS.

Las políticas permisivas se evalúan **todas** y se combinan con OR: alcanza con que **una** de las
que aplican explote para tumbar la consulta entera.

## Lo que ya nos costó

**2026-08-05 — Realtime de la bandeja.** Se publicaron `conversations` y `messages` en
`supabase_realtime` (migración 00068). El canal decía `SUBSCRIBED` y no entregaba una sola fila;
había que recargar para ver un mensaje nuevo. Se persiguió por el lado del socket, de la
autenticación del JWT y de la hidratación de React antes de encontrar esto. Arreglado en la
migración **00099** con el patrón de abajo.

Este documento **ya anticipaba ese caso por escrito** — "si alguna tabla necesita acceso desde
browser client (ej: Realtime subscription)" — y lo pisamos igual, porque nadie lo abre antes de
escribir una migración. Por eso la regla operativa ahora vive en `CLAUDE.md`, y este archivo queda
solo como inventario.

## El fix (patrón establecido, migraciones 00067 / 00099)

```sql
-- public.get_user_clinic_id() es SECURITY DEFINER: adentro corre como postgres,
-- así que no dispara la RLS de clinic_users. Sin recursión.
DROP POLICY "..." ON tabla;
CREATE POLICY "..." ON tabla FOR SELECT USING (clinic_id = public.get_user_clinic_id());
```

⚠ Esa función tiene su propia deuda abierta (`LIMIT 1` = un usuario, una clínica). Está anotada en
`CLAUDE.md` como bloqueante previo a vender el segundo cliente.

## Inventario al 2026-08-05

Leído de `pg_policies`, no de memoria. **Publicada en Realtime** = ya está expuesta al navegador,
así que el bug es alcanzable hoy.

| Tabla | Recursa vía | ¿En Realtime? |
|---|---|---|
| **`appointments`** (2 políticas) | `doctors` | 🔴 **SÍ — es la próxima que va a chocar** |
| `clinic_users` | auto-referencia (la raíz) | no |
| `doctors` | auto-referencia (la raíz) | no |
| `clinics` (2) | `doctors` | no |
| `patients` (2) | `doctors` | no |
| `audit_log`, `cartera`, `reminders`, `waitlist` | `doctors` | no |
| `consultation_types` (3), `consultation_type_rules` (3), `consultation_type_schedules` (2) | `clinic_users` | no |
| `conversation_media` (2), `isalud_import_staging` (3) | `clinic_users` | no |
| `blocked_dates` (2), `specialty_notifications` (3) | `clinic_users` | no |
| `clinic_roles`, `clinic_setup_progress` (2), `api_usage` | `clinic_users` | no |

Ya arregladas y fuera de la lista: `pending_contacts` (00067), `conversations` y `messages` (00099).

**No aplicar el fix preventivamente a las demás.** Funcionan con `service_role` y cambiar
políticas sin necesidad agrega riesgo sin beneficio. La regla es al revés: **cuando una tabla
vaya a leerse desde el navegador — Realtime o query directa con la anon key — se arregla su
política primero.**

Arreglar `clinic_users` y `doctors` en la raíz eliminaría la clase entera, pero toca el límite
multi-tenant de todo el esquema: es un trabajo con su propia verificación, no un fix de paso.
