# Notificación in-app persistente de escalaciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la campana de Omuwan cubra escalaciones con una alerta persistente que solo se limpia cuando alguien atiende la conversación.

**Architecture:** Se reutiliza la infraestructura existente (`staff_notifications` + `NotificationBell` + Supabase Realtime + fan-out por usuario). Se agrega un tipo `conversation_escalated`, un helper idempotente que inserta la notif en los 5 puntos de escalación del webhook, un resolver que la limpia clinic-wide cuando se atiende, exclusión de escalaciones del "marcar leído" manual, y un guard en el cron de limpieza para que no borre escalaciones no resueltas.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres + Realtime), tests con `npx tsx scripts/test-*.ts` (assert manual, sin framework).

## Global Constraints

- TypeScript estricto. No `any`. Comentarios y UI en español, nombres técnicos en inglés.
- Filtrar SIEMPRE por `clinic_id`. RLS activo.
- El cambio al webhook (`src/app/api/webhooks/whatsapp/route.ts`) es **100% aditivo**: no se modifica ninguna rama existente, solo se agregan llamadas. Cada llamada al helper se hace `await` **dentro de try/catch** — si la notif falla, se traga el error y la escalación sigue su curso (fire-and-forget en el sentido de "nunca rompe el flujo"; se usa `await`-en-try/catch en vez de promesa suelta porque en serverless una promesa sin await puede morir cuando la función retorna).
- El único cliente es Algia (`clinic_id = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'`). Cualquier escritura a esa DB es producción real.
- Migración nueva: `00080` (la última aplicada es `00079`).
- Resolución = atender: reabrir, marcar resuelta, **o** responder desde el chat. Clinic-wide por `conversation_id`.
- Escalaciones NO se limpian por: "marcar todas", click individual, ni el cron de 30 días. Solo por atender.
- NO bumpear `created_at` de una alerta viva (el "hace X" debe reflejar cuánto lleva esperando la tanda).

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `supabase/migrations/00080_staff_notifications_escalation.sql` | CHECK + columna `conversation_id` + índice parcial | Crear |
| `src/lib/notifications/types.ts` | Agregar el tipo `conversation_escalated`; loosen metadata | Modificar |
| `src/lib/notifications/escalation-notify.ts` | `buildEscalationPayload` (puro), `notifyStaffOfEscalation` (idempotente), `resolveEscalationNotifications` | Crear |
| `src/lib/notifications/create-notification.ts` | Aceptar `conversationId` para setear la columna real | Modificar |
| `scripts/test-escalation-notify.ts` | Unit tests del builder puro | Crear |
| `scripts/smoke-escalation-notif.ts` | Smoke DB: dispara/resuelve una escalación real para ver la campana | Crear |
| `src/app/api/webhooks/whatsapp/route.ts` | 5 llamadas a `notifyStaffOfEscalation` (aditivo) | Modificar |
| `src/app/actions/conversations.ts` | Llamar `resolveEscalationNotifications` en reopen/resolve/sendStaffMessage | Modificar |
| `src/app/api/cron/cleanup-notifications/route.ts` | Excluir escalaciones no resueltas del DELETE | Modificar |
| `src/components/dashboard/notification-bell.tsx` | Excluir escalaciones de markAllRead/click; emoji 🚨 | Modificar |

---

## Task 1: Migración — schema para escalaciones

**Files:**
- Create: `supabase/migrations/00080_staff_notifications_escalation.sql`

**Interfaces:**
- Produces: columna `staff_notifications.conversation_id UUID`; tipo `'conversation_escalated'` válido en el CHECK; índice `idx_notif_conv_escalated`.

- [ ] **Step 1: Escribir la migración**

Create `supabase/migrations/00080_staff_notifications_escalation.sql`:

```sql
-- ============================================================
-- 00080_staff_notifications_escalation.sql
--
-- Habilita notificaciones in-app de escalación de conversaciones.
--   - Agrega 'conversation_escalated' al CHECK de type.
--   - Agrega columna conversation_id (real, indexable) para resolución
--     clinic-wide: al atender, se limpian TODAS las notifs de esa
--     conversación de una sola query.
--   - Índice parcial para: (a) el chequeo de idempotencia del helper y
--     (b) la resolución. Solo cubre escalaciones no resueltas.
-- ============================================================

ALTER TABLE staff_notifications DROP CONSTRAINT IF EXISTS staff_notifications_type_check;

ALTER TABLE staff_notifications ADD CONSTRAINT staff_notifications_type_check
  CHECK (type IN (
    'appointment_canceled',
    'appointment_rescheduled',
    'appointment_moved',
    'conversation_escalated'
  ));

ALTER TABLE staff_notifications
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notif_conv_escalated
  ON staff_notifications(conversation_id)
  WHERE type = 'conversation_escalated' AND read_at IS NULL;
```

- [ ] **Step 2: Aplicar la migración en producción**

Usar `mcp__claude_ai_Supabase__apply_migration` con project_id `rftbdhhbiyyoentvorqk`, name `staff_notifications_escalation`, y el SQL de arriba.

- [ ] **Step 3: Verificar el schema aplicado**

Ejecutar con `mcp__claude_ai_Supabase__execute_sql` (project_id `rftbdhhbiyyoentvorqk`):

```sql
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'staff_notifications_type_check') AS check_def,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='staff_notifications' AND column_name='conversation_id') AS has_conv_col,
  (SELECT count(*) FROM pg_indexes WHERE indexname='idx_notif_conv_escalated') AS has_index;
```

Expected: `check_def` contiene `'conversation_escalated'`; `has_conv_col=1`; `has_index=1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00080_staff_notifications_escalation.sql
git commit -m "feat(escalacion): migracion 00080 — tipo conversation_escalated + conversation_id"
```

---

## Task 2: Tipo + payload builder puro (con unit test)

**Files:**
- Modify: `src/lib/notifications/types.ts`
- Create: `src/lib/notifications/escalation-notify.ts` (solo el builder puro en esta task)
- Create: `scripts/test-escalation-notify.ts`

**Interfaces:**
- Consumes: `NotificationType` de `types.ts`.
- Produces:
  - `type NotificationType` extendido con `'conversation_escalated'`.
  - `buildEscalationPayload(patientName: string | null, reason: string, conversationId: string): { type: 'conversation_escalated'; title: string; body: string; navigateTo: string }` — puro, sin DB.

- [ ] **Step 1: Escribir el test que falla**

Create `scripts/test-escalation-notify.ts`:

```typescript
// scripts/test-escalation-notify.ts
import { buildEscalationPayload } from '../src/lib/notifications/escalation-notify'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests escalation-notify (builder puro)\n')

// Nombre presente → título con el nombre
{
  const p = buildEscalationPayload('Ana Gómez', 'quiero una cita urgente', 'conv-1')
  assert('type es conversation_escalated', p.type === 'conversation_escalated')
  assert('title incluye el nombre', p.title.includes('Ana Gómez'), p.title)
  assert('navigateTo apunta a la conversación', p.navigateTo === '/dashboard/conversations/conv-1', p.navigateTo)
  assert('body incluye el motivo', p.body.includes('quiero una cita urgente'), p.body)
}

// Sin nombre → fallback "Paciente nuevo"
{
  const p = buildEscalationPayload(null, 'hola', 'conv-2')
  assert('title usa "Paciente nuevo" si no hay nombre', p.title.includes('Paciente nuevo'), p.title)
}

// Motivo largo → body truncado a 120 chars + elipsis
{
  const longReason = 'x'.repeat(300)
  const p = buildEscalationPayload('Ana', longReason, 'conv-3')
  assert('body truncado a <= 123 chars (120 + "...")', p.body.length <= 123, `len=${p.body.length}`)
  assert('body termina en "..."', p.body.endsWith('...'), p.body.slice(-5))
}

// Motivo corto → sin elipsis
{
  const p = buildEscalationPayload('Ana', 'corto', 'conv-4')
  assert('body corto no lleva elipsis', !p.body.endsWith('...'), p.body)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx tsx scripts/test-escalation-notify.ts`
Expected: FAIL — el módulo `escalation-notify` no existe / `buildEscalationPayload is not a function`.

- [ ] **Step 3: Extender el tipo**

Modify `src/lib/notifications/types.ts` línea 5:

```typescript
export type NotificationType = 'appointment_canceled' | 'appointment_rescheduled' | 'appointment_moved' | 'conversation_escalated'
```

Y en el mismo archivo, loosen `metadata` en `NotificationPayload` (línea 24) para que el payload sea reusable por escalaciones (el objeto estricto de citas sigue siendo válido porque satisface `Record<string, unknown>`):

```typescript
export interface NotificationPayload {
  type: NotificationType
  title: string
  body?: string
  metadata: Record<string, unknown>
  navigateTo: string
}
```

- [ ] **Step 4: Escribir el builder puro**

Create `src/lib/notifications/escalation-notify.ts`:

```typescript
// ============================================================
// Notificación in-app de escalación de conversaciones.
// buildEscalationPayload es puro (testeable sin DB). El resto
// (notifyStaffOfEscalation / resolveEscalationNotifications) toca
// DB y se agrega en la Task 3.
// ============================================================

const MAX_BODY = 120

/** Trunca a MAX_BODY chars agregando "..." si se pasó. Puro. */
function truncate(s: string): string {
  const t = s.trim()
  return t.length > MAX_BODY ? t.slice(0, MAX_BODY) + '...' : t
}

/**
 * Construye el payload de una notif de escalación. Puro, sin DB.
 * NO incluye recipient — el fan-out lo hace notifyStaffOfEscalation.
 */
export function buildEscalationPayload(
  patientName: string | null,
  reason: string,
  conversationId: string,
): { type: 'conversation_escalated'; title: string; body: string; navigateTo: string } {
  const displayName = patientName?.trim() || 'Paciente nuevo'
  return {
    type: 'conversation_escalated',
    title: `${displayName} necesita atención`,
    body: truncate(reason),
    navigateTo: `/dashboard/conversations/${conversationId}`,
  }
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `npx tsx scripts/test-escalation-notify.ts`
Expected: PASS — `8 passed, 0 failed`.

- [ ] **Step 6: Verificar que no rompimos las notifs de cita (typecheck)**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos. (El objeto estricto de metadata en `create-notification.ts` sigue compilando contra `Record<string, unknown>`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications/types.ts src/lib/notifications/escalation-notify.ts scripts/test-escalation-notify.ts
git commit -m "feat(escalacion): tipo conversation_escalated + buildEscalationPayload puro con tests"
```

---

## Task 3: Helper idempotente + resolver (DB) + smoke

**Files:**
- Modify: `src/lib/notifications/create-notification.ts:16-63` (aceptar `conversationId`)
- Modify: `src/lib/notifications/escalation-notify.ts` (agregar las 2 funciones DB)
- Create: `scripts/smoke-escalation-notif.ts`

**Interfaces:**
- Consumes: `createStaffNotification(clinicId, payload, conversationId?)`, `buildEscalationPayload(...)`.
- Produces:
  - `createStaffNotification(clinicId: string, payload: NotificationPayload, conversationId?: string): Promise<number>` (firma extendida).
  - `notifyStaffOfEscalation(params: { clinicId: string; conversationId: string; patientName: string | null; reason: string }): Promise<void>` — idempotente, nunca lanza.
  - `resolveEscalationNotifications(conversationId: string): Promise<void>` — clinic-wide, nunca lanza.

- [ ] **Step 1: Extender `createStaffNotification` para setear `conversation_id`**

Modify `src/lib/notifications/create-notification.ts`. Cambiar la firma (línea 16-19) y el armado de filas (línea 42-50):

```typescript
export async function createStaffNotification(
  clinicId: string,
  payload: NotificationPayload,
  conversationId?: string,
): Promise<number> {
```

Y en el `.map` de filas, agregar la columna:

```typescript
  const rows = uniqueUserIds.map((userId) => ({
    clinic_id: clinicId,
    recipient_user_id: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body ?? null,
    metadata: payload.metadata,
    navigate_to: payload.navigateTo,
    conversation_id: conversationId ?? null,
  }))
```

(Las notifs de cita no pasan `conversationId` → queda `null`, comportamiento sin cambios.)

- [ ] **Step 2: Agregar `notifyStaffOfEscalation` y `resolveEscalationNotifications`**

Append a `src/lib/notifications/escalation-notify.ts`:

```typescript
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createStaffNotification } from './create-notification'

/**
 * Inserta una notif de escalación para todo el staff no-Doctor de la
 * clínica. IDEMPOTENTE: si ya hay una escalación NO resuelta para esa
 * conversación, no hace nada (una sola alerta viva por conversación).
 * Nunca lanza — fire-and-forget seguro para el webhook.
 */
export async function notifyStaffOfEscalation(params: {
  clinicId: string
  conversationId: string
  patientName: string | null
  reason: string
}): Promise<void> {
  const { clinicId, conversationId, patientName, reason } = params
  try {
    // Idempotencia: ¿ya hay una alerta viva para esta conversación?
    const { data: existing } = await supabaseAdmin
      .from('staff_notifications')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('type', 'conversation_escalated')
      .is('read_at', null)
      .limit(1)
      .maybeSingle()

    if (existing) return // alerta viva → no multiplicar filas

    const payload = buildEscalationPayload(patientName, reason, conversationId)
    await createStaffNotification(
      clinicId,
      { type: payload.type, title: payload.title, body: payload.body, metadata: { patient_name: patientName ?? null }, navigateTo: payload.navigateTo },
      conversationId,
    )
  } catch (err) {
    console.error('[Escalation] notifyStaffOfEscalation falló (no crítico):', err)
  }
}

/**
 * Resuelve (marca read_at) TODAS las notifs de escalación no resueltas de
 * una conversación — clinic-wide, de una query. Se llama cuando alguien
 * atiende (reabrir / resolver / responder). Idempotente. Nunca lanza.
 */
export async function resolveEscalationNotifications(conversationId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('staff_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('type', 'conversation_escalated')
      .is('read_at', null)
  } catch (err) {
    console.error('[Escalation] resolveEscalationNotifications falló (no crítico):', err)
  }
}
```

- [ ] **Step 3: Escribir el smoke script (dispara + verifica idempotencia + resuelve)**

Create `scripts/smoke-escalation-notif.ts`:

```typescript
// scripts/smoke-escalation-notif.ts
// Smoke DB contra Algia. Crea una conversación escalada de prueba,
// dispara la notif dos veces (verifica idempotencia), luego resuelve.
// NO deja basura: borra la conversación de prueba al final.
//
// Run: TZ=America/Bogota npx tsx scripts/smoke-escalation-notif.ts
import { existsSync, readFileSync } from 'fs'
function loadEnv(p: string) {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv('.env.production.local'); loadEnv('.env.local')

import { supabaseAdmin } from '../src/lib/supabase/admin'
import { notifyStaffOfEscalation, resolveEscalationNotifications } from '../src/lib/notifications/escalation-notify'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

async function main() {
  // 1. Crear una conversación de prueba escalada
  const { data: conv, error: convErr } = await supabaseAdmin
    .from('conversations')
    .insert({ clinic_id: ALGIA, whatsapp_phone: '+570000000000', status: 'escalated', escalated_at: new Date().toISOString() })
    .select('id').single()
  if (convErr || !conv) { console.error('No pude crear conversación de prueba', convErr); process.exit(1) }
  const convId = (conv as { id: string }).id
  console.log('Conversación de prueba:', convId)

  // 2. Disparar la notif dos veces → idempotencia
  await notifyStaffOfEscalation({ clinicId: ALGIA, conversationId: convId, patientName: 'SMOKE Test', reason: 'prueba de escalación' })
  await notifyStaffOfEscalation({ clinicId: ALGIA, conversationId: convId, patientName: 'SMOKE Test', reason: 'segundo mensaje' })

  const { data: afterInsert } = await supabaseAdmin
    .from('staff_notifications').select('recipient_user_id, read_at')
    .eq('conversation_id', convId).eq('type', 'conversation_escalated')
  const staffCount = afterInsert?.length ?? 0
  const distinctUsers = new Set((afterInsert ?? []).map((r) => (r as { recipient_user_id: string }).recipient_user_id)).size
  console.log(`Filas tras 2 disparos: ${staffCount} (usuarios distintos: ${distinctUsers})`)
  console.log(staffCount === distinctUsers ? '✅ idempotente: 1 fila por usuario, no duplica' : '❌ duplicó filas')

  // 3. Resolver → todas read_at
  await resolveEscalationNotifications(convId)
  const { data: afterResolve } = await supabaseAdmin
    .from('staff_notifications').select('read_at')
    .eq('conversation_id', convId).eq('type', 'conversation_escalated')
  const allRead = (afterResolve ?? []).every((r) => (r as { read_at: string | null }).read_at !== null)
  console.log(allRead ? '✅ resolución: todas las filas quedaron read_at' : '❌ quedaron filas sin resolver')

  // 4. Re-disparar tras resolver → re-crea (5º camino)
  await notifyStaffOfEscalation({ clinicId: ALGIA, conversationId: convId, patientName: 'SMOKE Test', reason: 'repregunta' })
  const { data: afterReraise } = await supabaseAdmin
    .from('staff_notifications').select('id').eq('conversation_id', convId)
    .eq('type', 'conversation_escalated').is('read_at', null)
  console.log((afterReraise?.length ?? 0) > 0 ? '✅ re-alerta tras resolver: hay alerta viva de nuevo' : '❌ no re-alertó')

  // 5. Limpieza: borrar la conversación de prueba (CASCADE borra sus notifs)
  await supabaseAdmin.from('staff_notifications').delete().eq('conversation_id', convId)
  await supabaseAdmin.from('conversations').delete().eq('id', convId)
  console.log('🧹 conversación y notifs de prueba borradas')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Correr el smoke y verificar**

Run: `TZ=America/Bogota npx tsx scripts/smoke-escalation-notif.ts`
Expected: cuatro ✅ (idempotente, resolución, re-alerta, y limpieza al final). Si Algia tiene 0 staff no-Doctor, `staffCount=0` — en ese caso verificar en la UI con un usuario real (Task 8) en vez del smoke.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/create-notification.ts src/lib/notifications/escalation-notify.ts scripts/smoke-escalation-notif.ts
git commit -m "feat(escalacion): helper idempotente + resolver clinic-wide + smoke DB"
```

---

## Task 4: Cablear el helper en los 5 puntos del webhook (aditivo)

**Files:**
- Modify: `src/app/api/webhooks/whatsapp/route.ts` (import + 5 llamadas)

**Interfaces:**
- Consumes: `notifyStaffOfEscalation({ clinicId, conversationId, patientName, reason })`.

**Nota de seguridad:** cada llamada va `await` dentro de un try/catch propio (o reutilizando el try/catch de la rama). El helper ya se auto-protege (nunca lanza), pero se usa `await` para garantizar que el insert corra antes de que la función serverless retorne. NO se modifica ninguna condición ni early-return existente — solo se agregan líneas.

- [ ] **Step 1: Agregar el import**

Modify `src/app/api/webhooks/whatsapp/route.ts` cerca de la línea 31 (junto al import de `notifyEscalationContact`):

```typescript
import { notifyStaffOfEscalation } from '@/lib/notifications/escalation-notify'
```

- [ ] **Step 2: Camino 5 — mensaje entrante sobre conversación ya escalada**

En el early-return de la línea 440-443, agregar la llamada **antes** del `return`:

```typescript
      // 15. Si la conversación está escalada → no responder (un humano se encarga)
      if (conversation.status === 'escalated') {
        // Re-alerta si no hay una viva (idempotente): la paciente sigue
        // esperando aunque Lady ya haya respondido antes. El mensaje ya
        // se guardó arriba (línea 431), así que se ve en el chat.
        await notifyStaffOfEscalation({
          clinicId: clinic.id,
          conversationId: conversation.id,
          patientName: patient.name,
          reason: sanitizedText,
        })
        console.log(`[Webhook] Conversación escalada, no responder. ID: ${conversation.id}`)
        return
      }
```

- [ ] **Step 3: Camino 1 — keyword**

En el bloque de keyword (tras el `.update({ status: 'escalated' ... })` de la línea ~475, junto al `notifyEscalationContact` de la línea 487), agregar:

```typescript
        await notifyStaffOfEscalation({
          clinicId: clinic.id,
          conversationId: conversation.id,
          patientName: patient.name,
          reason: sanitizedText,
        })
```

- [ ] **Step 4: Camino 2 — tool `escalate_to_human`**

En el bloque de la línea 726-743 (tras el `.update({ status: 'escalated' })` y junto al `notifyEscalationContact` de la línea 736), agregar:

```typescript
        await notifyStaffOfEscalation({
          clinicId: clinic.id,
          conversationId: conversation.id,
          patientName: patient.name,
          reason: sanitizedText,
        })
```

- [ ] **Step 5: Camino 3 — autorización recibida (flag ON)**

En el bloque `if (isAuthContext) { ... }` (línea ~379-394), tras el `.update({ status: 'escalated' ... })`, agregar (dentro del try existente):

```typescript
            await notifyStaffOfEscalation({
              clinicId: clinic.id,
              conversationId: conversation.id,
              patientName: patient.name,
              reason: 'Autorización recibida — pendiente de revisión',
            })
```

- [ ] **Step 6: Camino 4 — archivo recibido con flag OFF**

En el bloque `if (!mediaEnabled) { ... }` (línea ~261-286), tras el `.update({ status: 'escalated' ... })`, agregar:

```typescript
          await notifyStaffOfEscalation({
            clinicId: clinic.id,
            conversationId: conversation.id,
            patientName: patient.name,
            reason: 'Paciente envió un archivo — recepción deshabilitada',
          })
```

- [ ] **Step 7: Typecheck + build del webhook**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 8: Verificación estática de que es aditivo**

Run: `git diff src/app/api/webhooks/whatsapp/route.ts`
Confirmar visualmente: **solo** hay líneas agregadas (import + 5 bloques `notifyStaffOfEscalation`). NINGUNA línea existente modificada ni borrada (los `return`, condiciones y updates originales intactos).

- [ ] **Step 9: Commit**

```bash
git add src/app/api/webhooks/whatsapp/route.ts
git commit -m "feat(escalacion): notif in-app en los 5 caminos del webhook (aditivo)"
```

---

## Task 5: Cablear el resolver en las 3 acciones de "atender"

**Files:**
- Modify: `src/app/actions/conversations.ts` (import + 3 llamadas)

**Interfaces:**
- Consumes: `resolveEscalationNotifications(conversationId)`.

- [ ] **Step 1: Import**

Modify `src/app/actions/conversations.ts` (con los otros imports del top):

```typescript
import { resolveEscalationNotifications } from '@/lib/notifications/escalation-notify'
```

- [ ] **Step 2: Resolver al responder desde el chat (`sendStaffMessage`)**

Tras el update de `last_message_at` (línea ~220-223), antes del audit log, agregar:

```typescript
    // Responder = atender: limpia la alerta de escalación de esta conversación.
    await resolveEscalationNotifications(conversationId)
```

- [ ] **Step 3: Resolver al marcar resuelta / re-escalar manual (`updateConversationStatus`)**

Dentro de `updateConversationStatus`, tras el update exitoso (línea ~274, antes del audit log), agregar — solo cuando pasa a `resolved`:

```typescript
    if (status === 'resolved') {
      await resolveEscalationNotifications(conversationId)
    }
```

- [ ] **Step 4: Resolver al reabrir (`reopenConversation`)**

Dentro de `reopenConversation`, tras el update exitoso (línea ~307, antes del audit log), agregar:

```typescript
    await resolveEscalationNotifications(conversationId)
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/conversations.ts
git commit -m "feat(escalacion): resolver la alerta al reabrir/resolver/responder"
```

---

## Task 6: Guard del cron de limpieza (no borrar escalaciones no resueltas)

**Files:**
- Modify: `src/app/api/cron/cleanup-notifications/route.ts:18-21`

**Interfaces:**
- (sin nuevas exports)

- [ ] **Step 1: Agregar el filtro `.or(...)`**

Modify `src/app/api/cron/cleanup-notifications/route.ts`. Cambiar el DELETE (línea 18-21):

```typescript
  const { error, count } = await supabaseAdmin
    .from('staff_notifications')
    .delete({ count: 'exact' })
    .lt('created_at', thirtyDaysAgo)
    // No borrar escalaciones NO resueltas: la alerta persiste hasta que
    // alguien atienda, sin importar la antigüedad. Se borran las notifs de
    // cita viejas y las escalaciones YA resueltas (read_at no nulo).
    .or('read_at.not.is.null,type.neq.conversation_escalated')
```

- [ ] **Step 2: Verificar el guard con el smoke**

Reusar la infra del smoke: crear una escalación no resuelta con `created_at` viejo y confirmar que el filtro NO la elige. Ejecutar con `mcp__claude_ai_Supabase__execute_sql` (project_id `rftbdhhbiyyoentvorqk`) esta simulación del filtro sin borrar nada:

```sql
-- Insertar una escalación no resuelta "vieja" (40 días) para un user cualquiera de Algia
WITH u AS (
  SELECT auth_user_id FROM clinic_users WHERE clinic_id='dac775fe-6ebd-47e3-89b4-eeb1a821facb' AND is_active LIMIT 1
), c AS (
  INSERT INTO conversations (clinic_id, whatsapp_phone, status)
  VALUES ('dac775fe-6ebd-47e3-89b4-eeb1a821facb', '+570000000001', 'escalated') RETURNING id
)
INSERT INTO staff_notifications (clinic_id, recipient_user_id, type, title, conversation_id, created_at)
SELECT 'dac775fe-6ebd-47e3-89b4-eeb1a821facb', u.auth_user_id, 'conversation_escalated', 'SMOKE vieja', c.id, now() - interval '40 days'
FROM u, c
RETURNING id, conversation_id;
```

Luego correr el MISMO filtro del cron como SELECT (no DELETE) y confirmar que la fila NO aparece (sobrevive):

```sql
SELECT count(*) AS serian_borradas
FROM staff_notifications
WHERE created_at < now() - interval '30 days'
  AND (read_at IS NOT NULL OR type <> 'conversation_escalated')
  AND title = 'SMOKE vieja';
```

Expected: `serian_borradas = 0` (la escalación no resuelta sobrevive).

- [ ] **Step 3: Limpiar la fila de prueba**

```sql
DELETE FROM conversations WHERE whatsapp_phone = '+570000000001' AND clinic_id='dac775fe-6ebd-47e3-89b4-eeb1a821facb';
-- CASCADE borra la staff_notification asociada
```

Verificar: `SELECT count(*) FROM staff_notifications WHERE title='SMOKE vieja';` → `0`.

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (sin errores nuevos)

```bash
git add src/app/api/cron/cleanup-notifications/route.ts
git commit -m "fix(escalacion): el cron de limpieza no borra escalaciones no resueltas"
```

---

## Task 7: Campana — no dejar matar escalaciones sin atender + emoji

**Files:**
- Modify: `src/components/dashboard/notification-bell.tsx` (markAllRead línea 97, handleNotifClick línea 104, TYPE_EMOJI línea ~17)

**Interfaces:**
- (cambios de UI, sin nuevas exports)

- [ ] **Step 1: Emoji del nuevo tipo**

Modify `src/components/dashboard/notification-bell.tsx`. En el objeto `TYPE_EMOJI` (línea ~17-21), agregar:

```typescript
  conversation_escalated: '🚨',
```

- [ ] **Step 2: Excluir escalaciones de "Marcar todas"**

Modify `markAllRead` (línea 97-102). Agregar `.neq('type', 'conversation_escalated')` al update y no tocar esas en el estado local:

```typescript
  const markAllRead = useCallback(async () => {
    if (!userId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from('staff_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_user_id', userId)
      .is('read_at', null)
      .neq('type', 'conversation_escalated')
    setNotifications((prev) => prev.map((n) =>
      n.type === 'conversation_escalated' ? n : { ...n, read_at: n.read_at ?? new Date().toISOString() }
    ))
  }, [userId])
```

- [ ] **Step 3: Excluir escalaciones del click individual**

Modify `handleNotifClick` (línea 104-108). Navegar siempre, pero NO marcar leída si es escalación:

```typescript
  function handleNotifClick(notif: StaffNotification) {
    if (!notif.read_at && notif.type !== 'conversation_escalated') markAsRead(notif.id)
    if (notif.navigate_to) router.push(notif.navigate_to)
    setIsOpen(false)
  }
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/notification-bell.tsx
git commit -m "feat(escalacion): escalaciones persisten en la campana (no se matan con marcar/click) + emoji"
```

---

## Task 8: Verificación manual — ver la campana saltar y NO limpiarse

Esta es la prueba que vale. No alcanza con "hecho": el usuario tiene que **ver** la campana saltar con una escalación real y confirmar que no se limpia sin atender. Esta task no cierra hasta que el usuario lo confirme viéndolo.

**Files:** (ninguno — es ejecución + observación)

- [ ] **Step 1: Deploy a producción**

El código ya está en la rama. Mergear/deployar según el flujo del proyecto (el dominio productivo es omuwan.co — usar el flujo de deploy habitual, NO `vercel deploy --prod` manual). Confirmar que el deploy está live antes de seguir.

- [ ] **Step 2: Abrir Omuwan y dejar la campana a la vista**

Login en https://omuwan.co con un usuario de Algia que sea staff no-Doctor (Admin/Coordinadora/Secretaria). Quedarse en cualquier pantalla del dashboard — la campana vive en el header, visible siempre. Anotar el userId del usuario logueado (o simplemente confirmar que es staff de Algia).

- [ ] **Step 3: Disparar una escalación real y VER la campana saltar**

En otra terminal, correr el smoke que crea una escalación real para todo el staff de Algia (incluye al usuario logueado):

Run: `TZ=America/Bogota npx tsx scripts/smoke-escalation-notif.ts`

**Observar (esto es lo que hay que ver):** la campana del header muestra el badge rosa con 🚨 **sin refrescar la página** (Realtime). Al abrir el dropdown: "SMOKE Test necesita atención", con "hace unos segundos".

⚠️ El smoke borra su conversación de prueba al final (paso de limpieza). Para la prueba visual conviene comentar temporalmente el bloque de limpieza (paso 5 del smoke) para que la notif quede visible mientras probás los pasos 4-6. Reactivarlo al terminar.

- [ ] **Step 4: Confirmar que "Marcar todas" NO la limpia**

Con la notif de escalación visible en el dropdown, hacer click en **"Marcar todas"**.
**Esperado:** la escalación 🚨 **sigue** en el badge (no se limpió). Si hubiera notifs de cita, esas sí se marcan leídas. Este es el punto clave: no se puede matar sin atender.

- [ ] **Step 5: Confirmar que el click individual NO la limpia**

Hacer click en la notif de escalación.
**Esperado:** navega a `/dashboard/conversations/{id}`, pero al volver, la alerta **sigue** en el badge. No se descartó con el click.

- [ ] **Step 6: Confirmar que atender SÍ la limpia**

En la conversación abierta, hacer una de estas tres (cualquiera): reabrir, marcar resuelta, o escribir una respuesta en el chat.
**Esperado:** el badge de escalación **desaparece en vivo** (Realtime propaga el UPDATE de read_at). Si hay un segundo usuario staff mirando su propia campana, también se le limpia (clinic-wide).

- [ ] **Step 7: Confirmar persistencia tras cerrar Omuwan**

Volver a disparar el smoke (o dejar una escalación viva). **Cerrar el navegador / cerrar la pestaña.** Reabrir Omuwan y loguear.
**Esperado:** la campana carga la escalación no resuelta desde la DB — el badge está ahí esperando. (Confirma que es estado persistente, no de sesión.)

- [ ] **Step 8: Limpieza final**

Correr el smoke una última vez con el bloque de limpieza activo (o borrar a mano la conversación de prueba):

```sql
DELETE FROM conversations
WHERE clinic_id='dac775fe-6ebd-47e3-89b4-eeb1a821facb' AND whatsapp_phone IN ('+570000000000','+570000000001');
```

Confirmar que no quedan notifs `SMOKE`:
```sql
SELECT count(*) FROM staff_notifications WHERE title LIKE 'SMOKE%';
```
Expected: `0`.

- [ ] **Step 9: Reporte al usuario (no "hecho" — mostrar cómo lo probó)**

Entregar al usuario: qué correr (`scripts/smoke-escalation-notif.ts`), qué mirar (campana salta por Realtime), y el resultado de los 3 chequeos clave — (a) marcar todas NO limpia, (b) click NO limpia, (c) atender SÍ limpia. Con capturas o descripción de lo observado, no solo "pasó".

---

## Self-Review (completado por el autor del plan)

**Spec coverage:**
- Sección 1 (migración: CHECK + conversation_id + índice) → Task 1. ✓
- Sección 2 (helper + fan-out + 5 caminos + idempotencia) → Task 2 (builder), Task 3 (helper), Task 4 (5 caminos). ✓
- Sección 3 (resolución: reopen/resolve/responder, clinic-wide) → Task 5. ✓
- Sección 4 (campana: excluir de markAll/click, emoji, badge) → Task 7. ✓
- Sección 5 (guard del cron) → Task 6. ✓
- Sección 6 ("hace cuánto": gratis, ya renderiza) → sin task (nada que construir); verificado visualmente en Task 8 Step 3. ✓
- Garantías de persistencia (cierre de navegador) → Task 8 Step 7. ✓

**Placeholder scan:** sin TBD/TODO/"handle edge cases". Todo el código está completo. ✓

**Type consistency:** `notifyStaffOfEscalation({ clinicId, conversationId, patientName, reason })`, `resolveEscalationNotifications(conversationId)`, `createStaffNotification(clinicId, payload, conversationId?)`, `buildEscalationPayload(patientName, reason, conversationId)` — nombres y firmas consistentes entre Tasks 2/3/4/5. ✓

**Nota de honestidad sobre testing:** el proyecto no usa framework de mocking; la lógica pura se testea con `tsx` (Task 2) y lo que toca DB se valida con smoke scripts + verificación manual (Tasks 3, 6, 8). No se inventaron unit tests con mocks que no encajan en el codebase.
