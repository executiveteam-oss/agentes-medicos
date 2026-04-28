# Notificaciones Internas al Staff — Plan de Implementacion

## 1. ESTRUCTURA DE ARCHIVOS

```
NUEVOS:
supabase/migrations/00064_staff_notifications.sql
src/lib/notifications/create-notification.ts     — Helper para emitir notifs
src/lib/notifications/types.ts                    — Tipos compartidos
src/components/dashboard/notification-bell.tsx     — Bell icon + badge + dropdown
src/app/api/cron/cleanup-notifications/route.ts   — Cron limpieza 30 dias

MODIFICADOS:
src/app/api/webhooks/whatsapp/route.ts            — Hook post-tool-execution
src/app/dashboard/layout.tsx                       — Bell en topbar
vercel.json                                        — Nuevo cron entry
```

---

## 2. SCHEMA: staff_notifications

```sql
CREATE TABLE staff_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  recipient_user_id UUID NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB DEFAULT '{}',
  navigate_to TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_recipient_unread
  ON staff_notifications(recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX idx_notif_clinic ON staff_notifications(clinic_id);

CREATE INDEX idx_notif_cleanup ON staff_notifications(created_at)
  WHERE created_at < NOW() - INTERVAL '30 days';

ALTER TABLE staff_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select_own" ON staff_notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY "notif_update_own" ON staff_notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid());

-- Realtime habilitado para esta tabla
ALTER PUBLICATION supabase_realtime ADD TABLE staff_notifications;
```

Types validos para `type`:
- `appointment_canceled` — paciente cancelo sin reagendar
- `appointment_rescheduled` — paciente reagendo (old→new)
- `appointment_moved` — paciente cancelo e inmediatamente agendo nueva (detectado por contexto)

---

## 3. HELPER: createStaffNotification

```typescript
// src/lib/notifications/create-notification.ts

interface NotificationPayload {
  type: 'appointment_canceled' | 'appointment_rescheduled' | 'appointment_moved'
  title: string
  body?: string
  metadata: {
    appointment_id?: string
    old_appointment_id?: string
    new_appointment_id?: string
    patient_id: string
    patient_name: string
    doctor_id: string
    doctor_name: string
    conversation_id: string
    old_starts_at?: string
    new_starts_at?: string
  }
  navigateTo: string  // '/dashboard/conversations/<id>'
}

async function createStaffNotification(
  clinicId: string,
  payload: NotificationPayload
): Promise<number>
```

Logica:
1. Query `clinic_users` WHERE `clinic_id` AND `is_active = true`
2. Join `clinic_roles` para obtener role name
3. Filtrar: solo roles con `conversations.read = true` (esto incluye Admin y Coordinadora, excluye Doctor y Secretaria basica segun los roles actuales del seed)
4. Para cada destinatario: INSERT en `staff_notifications` con `recipient_user_id = clinic_user.auth_user_id`
5. Return count de notifs creadas
6. Log: `[Notifications] Created {count} notifications for clinic {clinicId} type={type}`

Si 0 destinatarios: log warning pero no fallar.

---

## 4. INTEGRACION CON EL AGENT

**Donde hookear:** En `src/app/api/webhooks/whatsapp/route.ts`, lineas ~448-460, DESPUES de que `agentResponse` vuelve de `runAppointmentAgent` y ANTES de enviar respuesta WhatsApp.

```typescript
// Despues de linea ~403: console.log(`[Webhook] Agente respondio. Tools usadas: [...]`)

// --- Staff notifications for appointment changes ---
if (agentResponse.toolsUsed.includes('cancel_appointment') ||
    agentResponse.toolsUsed.includes('reschedule_appointment')) {
  try {
    await notifyStaffOfAppointmentChange({
      clinicId: clinic.id,
      conversationId: conversation.id,
      toolsUsed: agentResponse.toolsUsed,
      patientName: patient.name,
    })
  } catch (err) {
    console.error('[Webhook] Staff notification failed (non-critical):', err)
  }
}
```

**Deteccion de los 3 tipos:**

```typescript
async function notifyStaffOfAppointmentChange(params) {
  const { toolsUsed } = params

  const hasCancellation = toolsUsed.includes('cancel_appointment')
  const hasReschedule = toolsUsed.includes('reschedule_appointment')

  if (hasCancellation && hasReschedule) {
    // Tipo: appointment_moved (cancelo + reagendo en la misma conversacion)
    type = 'appointment_moved'
    title = `${patientName} movio su cita`
  } else if (hasReschedule) {
    // Tipo: appointment_rescheduled (solo reagendo, sin cancelar)
    type = 'appointment_rescheduled'
    title = `${patientName} reagendo su cita`
  } else {
    // Tipo: appointment_canceled (solo cancelo)
    type = 'appointment_canceled'
    title = `${patientName} cancelo su cita`
  }
}
```

Para obtener detalles (doctor, fechas), la funcion consulta la ultima cita cancelada/reagendada del paciente en los ultimos 5 minutos (evita race conditions con un window temporal).

**Importante:** Esta logica vive en `src/lib/notifications/create-notification.ts`, NO en route.ts. El webhook solo llama la funcion con los parametros minimos.

---

## 5. UI: NotificationBell

**Ubicacion:** En el topbar del dashboard layout (linea ~328), antes del spacer `<div className="flex-1" />`:

```tsx
<header ...>
  <SidebarToggle />
  <div className="flex-1" />
  <NotificationBell />  {/* ← aqui */}
</header>
```

**Componente client con estas partes:**

Icono colapsado:
- Lucide `Bell` icon, 20px, color text-muted
- Badge circular pink con count de unread (solo si > 0)
- Hover: color text

Dropdown (click toggle):
- Panel 360px ancho, max-height 480px, fixed o absolute
- Header: "Notificaciones" peso 700 + boton "Marcar todas como leidas"
- Lista de items (max 10 ultimas, ordenadas por created_at DESC)
- Cada item:
  - Emoji segun tipo: ❌ canceled, 🔄 rescheduled, ➡️ moved
  - Title (peso 600 si unread, 400 si read)
  - Body truncado a 1 linea
  - Tiempo relativo ("hace 5 min") en mono
  - Click: mark as read + router.push(navigate_to)
  - Dot azul si unread
- Footer: "Ver todas →" link a /dashboard/notifications (TODO — no implementar pagina ahora)
- Empty state: "Sin notificaciones nuevas"

**Mark as read:**
- Individual: al hacer click en el item, UPDATE staff_notifications SET read_at = NOW() WHERE id = X
- Todas: UPDATE staff_notifications SET read_at = NOW() WHERE recipient_user_id = auth.uid() AND read_at IS NULL
- Ambos via supabaseAdmin (desde el componente client, usar fetch a un API route o directamente via Supabase client con RLS)

Decision: usar Supabase client directo desde el componente (RLS protege, no necesita API route dedicada). Esto simplifica y evita crear 2 API routes extra.

---

## 6. SUPABASE REALTIME

El componente `NotificationBell` se suscribe a:

```typescript
const channel = supabase
  .channel('staff-notifications')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'staff_notifications',
      filter: `recipient_user_id=eq.${userId}`,
    },
    (payload) => {
      // Agregar al tope de la lista
      // Incrementar badge count
    }
  )
  .subscribe()
```

Prerequisito: la tabla debe estar en `supabase_realtime` publication (incluido en la migracion).

Multiples tabs: cada tab tiene su propia suscripcion. Cuando una tab marca como leido, las otras tabs lo veran via UPDATE event (agregar listener para UPDATE tambien).

Sin sonido en Fase 1 — solo visual. Sonido es Fase 2 con permission API.

---

## 7. CRON DE LIMPIEZA

Nuevo archivo: `src/app/api/cron/cleanup-notifications/route.ts`

```typescript
export async function GET(request: Request) {
  // Verificar CRON_SECRET
  // DELETE FROM staff_notifications WHERE created_at < NOW() - INTERVAL '30 days'
  // Log count eliminado
  // Return 200
}
```

Agregar a `vercel.json`:
```json
{
  "path": "/api/cron/cleanup-notifications",
  "schedule": "0 4 * * *"  // 11pm COT diario
}
```

Race condition con lectura: no es problema porque el DELETE usa `created_at < 30 dias` y nadie lee notifs tan viejas. Si alguien tiene el dropdown abierto con una notif de hace 31 dias y el cron la borra, simplemente desaparece al refrescar.

---

## 8. CHECKPOINTS DE TESTING

1. **Seed manual:** INSERT directo en `staff_notifications` via Supabase dashboard → bell aparece con badge
2. **Cancelar via WhatsApp:** mandar "cancela mi cita" como paciente → admin ve notif "Patricia cancelo su cita..."
3. **Reagendar via WhatsApp:** mandar "quiero cambiar mi cita al martes" → admin ve notif "Patricia reagendo su cita..."
4. **Cancel + reagendar:** mandar "cancela y agendame para otro dia" → admin ve notif "Patricia movio su cita..."
5. **Multiples admins:** crear 2 clinic_users admin → ambos reciben la misma notif
6. **Click notif:** click navega a /dashboard/conversations/{id}
7. **Mark read individual:** click → dot azul desaparece, read_at se setea en DB
8. **Mark all read:** boton → todas pierden dot, badge se resetea
9. **Realtime:** abrir 2 tabs, cancelar cita → ambas tabs actualizan badge
10. **Cron cleanup:** insertar notif con created_at = hace 31 dias → ejecutar cron → notif eliminada
11. **Edge: 0 admins:** clinica sin staff activo → log warning, no crash
12. **Edge: doctor cancela via dashboard:** NO debe generar notif (source != 'agent')

---

## 9. RIESGOS Y MITIGACION

| Riesgo | Prob | Impacto | Mitigacion |
|--------|------|---------|------------|
| 2 sesiones abiertas: badge inconsistente | Media | Bajo | Supabase Realtime UPDATE event sincroniza read_at entre tabs |
| 0 admins/secretarias activos | Baja | Nulo | Log warning, return 0, no crash |
| Cron borra mientras alguien lee | Baja | Bajo | Solo borra >30 dias, nadie lee tan viejo. Si desaparece, proximo refresh la quita |
| Integracion falla silenciosamente | Media | Alto | Log explicito `[Webhook] Staff notification failed` + non-critical try/catch (no bloquea respuesta al paciente) |
| Deteccion de "moved" falla por timing | Baja | Bajo | Window de 5 minutos para detectar cancel+reschedule en misma sesion. Si falla, se reporta como 2 notifs separadas (cancel + reschedule) — aceptable |
| Prompt injection en title via nombre paciente | Baja | Bajo | Title se construye server-side con template string, no user input directo al HTML. XSS prevenido por React's default escaping |
| Tabla crece mucho (miles de notifs) | Baja | Medio | Indice parcial en unread + cron diario de limpieza. Max ~1000 notifs/mes para clinica activa |

---

## 10. ESTIMACION DE TIEMPO

| Bloque | Horas | Notas |
|--------|-------|-------|
| Migracion SQL + tabla | 0.5h | Schema simple, 1 tabla |
| Helper createStaffNotification | 1h | Query destinatarios + batch insert + deteccion tipo |
| Integracion con webhook route.ts | 1.5h | Hook post-tool, detectar tipo, obtener metadata de citas |
| NotificationBell UI | 2.5h | Badge, dropdown, items, mark read, empty state |
| Supabase Realtime subscription | 1h | Channel setup, INSERT/UPDATE handlers |
| Cron cleanup + vercel.json | 0.5h | Simple DELETE + verify CRON_SECRET |
| Testing manual 12 casos | 2h | Requiere env local con WhatsApp o manual inserts |
| **Total** | **~9h** | **~1.5 dias de trabajo** |
