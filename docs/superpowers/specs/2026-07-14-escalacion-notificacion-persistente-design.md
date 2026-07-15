# Notificación in-app persistente de escalaciones — Diseño

**Fecha:** 2026-07-14
**Estado:** Propuesta para revisión
**Contexto:** Piloto Algia. Las secretarias trabajan todo el día dentro de Omuwan; se descartan avisos a celular/correo.

---

## Problema

Cuando el agente WhatsApp escala una conversación (`conversations.status='escalated'`), la secretaria **no recibe ningún aviso in-app**. La campana de Omuwan (`NotificationBell`) solo cubre cambios de citas — su tabla `staff_notifications` tiene un CHECK que no admite escalaciones. Hoy la escalación es 100% pasiva: la conversación aparece en `/dashboard/conversations` (ordenada arriba) y solo se ve si la secretaria tiene esa pantalla abierta. Los caminos de autorización/archivo ni siquiera disparan el aviso externo — escalan mudos.

## Objetivo

Que la campana de Omuwan cubra escalaciones con una alerta **persistente**: visible desde cualquier pantalla, que sobrevive al cierre del navegador, y que **solo se limpia cuando alguien atiende la conversación** — nunca por descarte accidental ni por antigüedad.

## No-objetivos (fuera de alcance)

- **Canales externos.** `escalation_contact_phone` y `ESCALATION_EMAIL` quedan como están, sin destinatario, sin usar. `notifyEscalationContact` no se borra ni se modifica. La notif in-app es el único canal.
- **Página `/dashboard/notifications`.** El TODO en `notification-bell.tsx:250` se ignora. El dropdown de la campana + el badge persistente cubren todo el requerimiento.
- **Push del navegador, service worker, sonido.** No se agregan.

---

## Diseño

### 1. Migración de base de datos

Nueva migración `supabase/migrations/00080_staff_notifications_escalation.sql` (la última aplicada es `00079`):

- **CHECK de `type`:** drop + recreate del constraint para agregar `'conversation_escalated'`. Los 3 tipos actuales (`appointment_canceled`, `appointment_rescheduled`, `appointment_moved`) se conservan.
- **Columna nueva `conversation_id UUID` nullable** con FK a `conversations(id) ON DELETE CASCADE`. Hoy el `conversation_id` vive dentro de `metadata` (JSONB) para las notifs de cita; para escalaciones lo necesito como columna real porque la resolución consulta "todas las notifs de esta conversación" y debe ser indexable.
- **Índice parcial** para la resolución: `CREATE INDEX idx_notif_conv_escalated ON staff_notifications(conversation_id) WHERE type='conversation_escalated' AND read_at IS NULL;`

Actualizar `NotificationType` en `src/lib/notifications/types.ts` para incluir el nuevo tipo.

### 2. Creación de la notificación — los 4 caminos, ninguno mudo

Nuevo helper en `src/lib/notifications/create-notification.ts`:

```
notifyStaffOfEscalation({ clinicId, conversationId, patientName, reason }): Promise<void>
```

Hace **fan-out por usuario** reutilizando `createStaffNotification` (una fila por cada `clinic_users` activo con rol ≠ Doctor — mismo patrón que las notifs de cita). Cada fila:
- `type='conversation_escalated'`
- `conversation_id` (columna nueva)
- `title` = `"{patientName} necesita atención"` (o "Paciente nuevo" si no hay nombre)
- `body` = el motivo/último mensaje truncado
- `navigate_to='/dashboard/conversations/{conversationId}'`

Se invoca en **los 4 puntos** de `src/app/api/webhooks/whatsapp/route.ts` donde se setea `status='escalated'`, incluidos los dos que hoy escalan mudos:

| Camino | file:line (aprox) | Hoy | Después |
|---|---|---|---|
| Keyword de escalación | `route.ts:468-497` | WhatsApp+email externo | + notif in-app |
| Tool `escalate_to_human` del agente | `route.ts:726-743` | WhatsApp+email externo | + notif in-app |
| Autorización recibida (flag ON) | `route.ts:379-394` | **mudo** | **notif in-app** |
| Archivo recibido (flag OFF) | `route.ts:277-286` | **mudo** | **notif in-app** |

**Aditivo y fire-and-forget.** Cada llamada va envuelta en try/catch (o `.catch()` sin await), igual que `notifyStaffOfAppointmentChange` hoy (`route.ts:746`). Si la notif falla, la escalación sigue su curso. No se modifica ninguna rama existente del webhook — solo se agregan las 4 llamadas. No se toca el parseo del mensaje, el agente, ni los early-returns.

### 3. Resolución — ligada al estado de la conversación (Opción A)

**La escalación no se resuelve por "leído", se resuelve cuando la conversación deja de estar `escalated` O cuando la secretaria le responde a la paciente.** Concretamente, "atender" = cualquiera de estas 3 acciones humanas:

1. **Reabrir** la conversación (`reopenConversation`, `src/app/actions/conversations.ts:295` → `status='active'`).
2. **Marcar resuelta** (`updateConversationStatus(..., 'resolved')`, `conversations.ts:254`).
3. **Responder desde el chat** (`sendStaffMessage`, `conversations.ts:167`) — aunque el estado siga `escalated`, contestarle a la paciente es hacerse cargo.

En las 3 acciones se llama a un nuevo resolver:

```
resolveEscalationNotifications(conversationId): Promise<void>
```

que hace `UPDATE staff_notifications SET read_at=now() WHERE conversation_id=$1 AND type='conversation_escalated' AND read_at IS NULL`.

**Clínica-wide por diseño:** marca las **N filas** (todos los destinatarios) de esa conversación de una sola vez. Si la secretaria A atiende, la alerta desaparece también del badge de la secretaria B — porque ya no hay nada que hacer. Ese es justamente el motivo de resolver por `conversation_id` y no por usuario.

Idempotente: llamarlo dos veces no hace nada la segunda vez (el filtro `read_at IS NULL`).

### 4. Persistencia — no se puede matar sin atender

Cambios en `src/components/dashboard/notification-bell.tsx`:

- **Excluir escalaciones de "Marcar todas"** (`markAllRead`, línea 97): el UPDATE agrega `.neq('type', 'conversation_escalated')`. "Marcar todas" limpia las notifs de cita pero **no** toca las escalaciones.
- **Excluir escalaciones del click individual** (`handleNotifClick` → `markAsRead`, línea 104): si la notif es de tipo `conversation_escalated`, navega a la conversación (`router.push(navigate_to)`) pero **no** setea `read_at`. La alerta se queda en el badge hasta que la conversación se atienda de verdad.
- **Emoji/estilo del nuevo tipo:** agregar entrada en `TYPE_EMOJI` (ej. 🚨) para `conversation_escalated`.

El badge (`unreadCount = notifications.filter(n => !n.read_at)`, línea 89) cuenta las escalaciones no resueltas automáticamente, sin cambios. Como `read_at` de una escalación solo se setea vía el resolver del punto 3, el badge persiste hasta que alguien atienda.

**Visibilidad global + Realtime: ya existen.** La campana vive en el header del layout (`src/app/dashboard/layout.tsx:353`), visible en todo el dashboard, y ya está suscripta por Realtime a INSERT/UPDATE de `staff_notifications` (`notification-bell.tsx:55-73`). Una escalación entrante salta sin refrescar; su resolución (UPDATE de `read_at`) también se propaga por Realtime y limpia el badge en vivo. Cero infraestructura nueva.

### 5. Protección contra limpieza automática (punto crítico del requerimiento)

**Hallazgo:** el cron `src/app/api/cron/cleanup-notifications/route.ts` hoy borra **cualquier** fila con `created_at` > 30 días, sin mirar si está resuelta. Una escalación sin atender por 30+ días desaparecería sola — viola "nada la limpia salvo atender".

**Fix:** el `DELETE` del cron excluye escalaciones no resueltas. El filtro pasa a borrar filas viejas **salvo** las escalaciones con `read_at IS NULL`:

```
.delete().lt('created_at', thirtyDaysAgo)
         .or('read_at.not.is.null,type.neq.conversation_escalated')
```

Efecto: una notif de cita vieja se borra normal; una escalación **resuelta** vieja se borra normal; una escalación **no resuelta** se conserva indefinidamente, sin importar la antigüedad. Solo el resolver del punto 3 (atender) permite que después sea elegible para limpieza.

**Confirmación explícita:** tras este cambio, **nada** limpia una escalación no atendida — ni el cron (excluida), ni "Marcar todas" (excluida), ni el click individual (excluido). El único camino a `read_at` es atender la conversación.

### 6. "Hace cuánto espera" — gratis

La campana ya renderiza `formatDistanceToNow(created_at, { locale: es })` en cada notif (`notification-bell.tsx:235`) → "hace 3 horas". La escalación lo hereda sin código extra. No se agrega nada.

*(Opcional, no ahora)*: la lista de conversaciones podría mostrar la antigüedad de `escalated_at` en cada entry escalada. Barato (el dato existe) pero fuera de este alcance.

---

## Garantías de persistencia (resumen)

| Escenario | Resultado |
|---|---|
| Secretaria cierra el navegador / se va a almorzar | Al reabrir, la campana carga las escalaciones no resueltas desde la DB (`notification-bell.tsx:38`). El badge las muestra. |
| Secretaria hace click en "Marcar todas" | Las escalaciones **no** se limpian (excluidas). Las notifs de cita sí. |
| Secretaria hace click en la notif de escalación | Navega a la conversación, pero la alerta **sigue** en el badge hasta atender. |
| Conversación escalada 30+ días sin atender | El cron **no** la borra (excluida). Sigue en el badge. |
| Secretaria A reabre/resuelve/responde | Se limpian las N filas de esa conversación → badge de A **y** de B queda limpio. |

---

## Análisis de riesgo

- **Webhook (crítico):** cambio 100% aditivo. Se agregan 4 llamadas fire-and-forget; no se modifica ninguna rama existente. Patrón idéntico al ya probado de `notifyStaffOfAppointmentChange`. Si la notif falla, el flujo de mensajes no se afecta.
- **Migración:** drop/recreate de un CHECK + columna nullable + índice. Tabla chica (~1000 filas, cleanup diario). Sin riesgo de datos.
- **Cron cleanup:** el filtro `.or(...)` es más conservador que hoy (borra menos, nunca más). No puede borrar de más.
- **Campana:** los cambios son exclusiones por tipo — las notifs de cita se comportan exactamente igual que hoy.

## Tests

- Unit del helper `notifyStaffOfEscalation`: fan-out correcto (N filas, una por staff no-Doctor), `conversation_id` seteado, `navigate_to` correcto.
- Unit del resolver `resolveEscalationNotifications`: marca todas las filas de la conversación, idempotente, no toca otras conversaciones ni otros tipos.
- Test del filtro del cron: escalación no resuelta vieja **no** se borra; escalación resuelta vieja **sí**; notif de cita vieja **sí**.
- E2E/integración de los 4 caminos del webhook: cada uno inserta la notif (mockeando Meta).
- Regresión: las notifs de cita y "Marcar todas" siguen funcionando igual.

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/00080_*.sql` | CHECK + columna `conversation_id` + índice |
| `src/lib/notifications/types.ts` | Nuevo tipo `conversation_escalated` |
| `src/lib/notifications/create-notification.ts` | Helper `notifyStaffOfEscalation` |
| `src/app/api/webhooks/whatsapp/route.ts` | 4 llamadas al helper (aditivo) |
| `src/app/actions/conversations.ts` | Resolver + llamadas en reopen/resolve/sendStaffMessage |
| `src/components/dashboard/notification-bell.tsx` | Excluir escalaciones de markAllRead/click; emoji |
| `src/app/api/cron/cleanup-notifications/route.ts` | Filtro `.or(...)` que preserva escalaciones no resueltas |

## Esfuerzo estimado

~1 día. Migración ~30 min · helper + 4 sitios del webhook ~1-2h · resolver + 3 hooks ~1h · ajuste de la campana ~1-2h · filtro del cron ~15 min · tests ~1-2h.
