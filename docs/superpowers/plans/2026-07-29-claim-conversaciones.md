# Claim de conversaciones (Pieza A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el equipo se reparta las conversaciones escaladas sin doble-atención: "tomar" una conversación (auto al abrir), verla en lista y chat, con modo blando (aviso) o duro (bloquea respuesta a las demás, con escape auditado) y vencimiento — todo configurable por clínica.

**Architecture:** 3 columnas nuevas en `conversations` + config en `clinics.feature_config.claim`. Lógica pura de vencimiento/estado en un módulo testeable. 3 server actions (claim/release/override) con `supabaseAdmin` filtrando por `clinic_id`. Display en la lista (`conversations-panel.tsx`) y el chat (`conversation-chat.tsx`), propagado por el canal de Realtime que YA existe (`conv-list-realtime` y `chat-<id>`). Config UI en el panel de usuarios renombrado "Equipo". Vencimiento computado AL LEER (sin cron).

**Tech Stack:** Next.js App Router (server components + `'use server'` actions), Supabase (Postgres + RLS + Realtime), TypeScript estricto, `tsx` para tests puros (patrón `scripts/test-*.ts`).

## Global Constraints

- **Pieza B (especialidades) NO entra en este plan.** A crea el panel "Equipo" con SOLO el bloque de Coordinación (config de claim). B le sumará "Miembros" después.
- **Invariante — el modo duro SIEMPRE tiene salida:** botón "Tomar de todos modos" (con confirmación) + vencimiento automático. Nunca un chat bloqueado sin escape.
- **Invariante — el override queda auditado:** cada "tomar de todos modos" inserta `audit_log` con `action='conversation_claim_override'`, `actor_id`, `details:{ from_user_id, from_user_name, minutes_held }`. No se resume.
- **Toggle OFF (`enabled=false`) = comportamiento actual exacto:** sin claim, sin banners, sin locks.
- **Defaults de config:** `enabled=true`, `mode='soft'`, `expiry_minutes=10`.
- **Vencimiento computado AL LEER** (`claimed_at + expiry_minutes < now → libre`). Sin cron.
- **Filtrar SIEMPRE por `clinic_id`** en toda action (verificar `conversation.clinic_id === session.clinicId`). RLS de `conversations` ya está activo; las actions usan `supabaseAdmin` (bypass) y validan clinic_id manualmente.
- **Gate de permiso de las actions de claim:** `conversations.write` (mismo que `sendStaffMessage`). El de la config de clínica: el MISMO gate que ya usan las escrituras del panel de usuarios (buscarlo, no inventar uno nuevo — ver deuda de gates en CLAUDE.md).
- **Zona horaria / dinero / TS estricto (sin `any`)** según CLAUDE.md.
- Commits en español: `feat(claim): ...`.

---

### Task 1: Migración de schema — columnas de claim

**Files:**
- Create: `supabase/migrations/00088_conversations_claim.sql`

**Interfaces:**
- Produces: `conversations.claimed_by UUID` (FK `clinic_users(id)`), `conversations.claimed_by_name TEXT`, `conversations.claimed_at TIMESTAMPTZ`. Todas nullable. Config vive en `clinics.feature_config.claim` (JSONB, sin migración de columna — `feature_config` ya existe).

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================
-- 00088_conversations_claim.sql
-- Pieza A — Claim de conversaciones. 3 columnas nullable.
-- Config por clínica vive en clinics.feature_config.claim (JSONB), sin columna.
-- Vencimiento se computa AL LEER, no hay estado derivado persistido.
-- ============================================================
BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES clinic_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.claimed_by IS
  'Pieza A claim: quién tomó la conversación. Vencimiento se computa al leer (claimed_at + feature_config.claim.expiry_minutes). claimed_by_name denormalizado para display sin join.';

COMMIT;
```

- [ ] **Step 2: Aplicar la migración a prod**

Aplicar vía el flujo de migraciones del proyecto (MCP `apply_migration` o `supabase db push`). Nombre: `00088_conversations_claim`.
Expected: 3 columnas nuevas en `conversations`, todas NULL para las filas existentes.

- [ ] **Step 3: Verificar**

Query:
```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name='conversations' AND column_name IN ('claimed_by','claimed_by_name','claimed_at');
```
Expected: 3 filas, todas `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00088_conversations_claim.sql
git commit -m "feat(claim): migración — columnas claimed_by/claimed_by_name/claimed_at"
```

---

### Task 2: Lógica pura de claim (config + vencimiento + estado)

**Files:**
- Create: `src/lib/rules/claim-logic.ts`
- Test: `scripts/test-claim-logic.ts`

**Interfaces:**
- Produces:
  - `interface ClaimConfig { enabled: boolean; mode: 'soft' | 'hard'; expiryMinutes: number }`
  - `const CLAIM_DEFAULTS: ClaimConfig`
  - `parseClaimConfig(featureConfig: unknown): ClaimConfig`
  - `interface ClaimRow { claimed_by: string | null; claimed_by_name: string | null; claimed_at: string | null }`
  - `type ClaimState = 'free' | 'mine' | 'others'`
  - `isClaimActive(claimedAt: string | null, expiryMinutes: number, nowMs: number): boolean`
  - `resolveClaimState(row: ClaimRow, myUserId: string, expiryMinutes: number, nowMs: number): { state: ClaimState; byName: string | null; heldMinutes: number | null }`
- Consumes: nada (módulo puro, sin DB/red).

- [ ] **Step 1: Escribir los tests (fallan)**

```ts
// scripts/test-claim-logic.ts
import {
  CLAIM_DEFAULTS, parseClaimConfig, isClaimActive, resolveClaimState,
} from '../src/lib/rules/claim-logic'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

const NOW = Date.parse('2026-07-29T12:00:00-05:00')
const MIN = 60_000

// --- parseClaimConfig ---
assert('defaults cuando no hay config', JSON.stringify(parseClaimConfig(null)) === JSON.stringify(CLAIM_DEFAULTS))
assert('defaults cuando falta la clave claim', JSON.stringify(parseClaimConfig({ otra: 1 })) === JSON.stringify(CLAIM_DEFAULTS))
assert('lee enabled=false', parseClaimConfig({ claim: { enabled: false } }).enabled === false)
assert('lee mode=hard', parseClaimConfig({ claim: { mode: 'hard' } }).mode === 'hard')
assert('mode inválido cae a soft', parseClaimConfig({ claim: { mode: 'xxx' } }).mode === 'soft')
assert('lee expiry_minutes', parseClaimConfig({ claim: { expiry_minutes: 5 } }).expiryMinutes === 5)
assert('expiry inválido/0 cae a default 10', parseClaimConfig({ claim: { expiry_minutes: 0 } }).expiryMinutes === 10)

// --- isClaimActive ---
assert('null claimed_at → inactivo', isClaimActive(null, 10, NOW) === false)
assert('hace 5 min con expiry 10 → activo', isClaimActive(new Date(NOW - 5 * MIN).toISOString(), 10, NOW) === true)
assert('hace 15 min con expiry 10 → vencido', isClaimActive(new Date(NOW - 15 * MIN).toISOString(), 10, NOW) === false)
assert('justo en el borde (10 min) → vencido', isClaimActive(new Date(NOW - 10 * MIN).toISOString(), 10, NOW) === false)

// --- resolveClaimState ---
const active5 = new Date(NOW - 5 * MIN).toISOString()
const expired15 = new Date(NOW - 15 * MIN).toISOString()
assert('libre cuando claimed_by null', resolveClaimState({ claimed_by: null, claimed_by_name: null, claimed_at: null }, 'me', 10, NOW).state === 'free')
assert('libre cuando vencida', resolveClaimState({ claimed_by: 'otro', claimed_by_name: 'Ana', claimed_at: expired15 }, 'me', 10, NOW).state === 'free')
assert('mía cuando claimed_by===yo y vigente', resolveClaimState({ claimed_by: 'me', claimed_by_name: 'Yo', claimed_at: active5 }, 'me', 10, NOW).state === 'mine')
const others = resolveClaimState({ claimed_by: 'otro', claimed_by_name: 'Ana', claimed_at: active5 }, 'me', 10, NOW)
assert('de otra cuando vigente y ajena', others.state === 'others' && others.byName === 'Ana')
assert('heldMinutes calculado', others.heldMinutes === 5)

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx tsx scripts/test-claim-logic.ts`
Expected: FAIL — "Cannot find module '../src/lib/rules/claim-logic'".

- [ ] **Step 3: Implementar el módulo**

```ts
// src/lib/rules/claim-logic.ts
// Lógica pura del claim de conversaciones (Pieza A). Sin DB/red.
// El vencimiento se computa AL LEER: claimed_at + expiryMinutes < now → libre.

export interface ClaimConfig {
  enabled: boolean
  mode: 'soft' | 'hard'
  expiryMinutes: number
}

export const CLAIM_DEFAULTS: ClaimConfig = { enabled: true, mode: 'soft', expiryMinutes: 10 }

/** Lee clinics.feature_config y devuelve la config de claim con defaults. Tolerante a basura. */
export function parseClaimConfig(featureConfig: unknown): ClaimConfig {
  const root = (featureConfig && typeof featureConfig === 'object') ? (featureConfig as Record<string, unknown>) : {}
  const raw = (root.claim && typeof root.claim === 'object') ? (root.claim as Record<string, unknown>) : {}
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : CLAIM_DEFAULTS.enabled
  const mode = raw.mode === 'hard' ? 'hard' : 'soft'
  const expRaw = raw.expiry_minutes
  const expiryMinutes = (typeof expRaw === 'number' && Number.isFinite(expRaw) && expRaw > 0) ? expRaw : CLAIM_DEFAULTS.expiryMinutes
  return { enabled, mode, expiryMinutes }
}

export interface ClaimRow {
  claimed_by: string | null
  claimed_by_name: string | null
  claimed_at: string | null
}

export type ClaimState = 'free' | 'mine' | 'others'

/** ¿El claim está vigente (no vencido)? Borde (exacto expiry) cuenta como VENCIDO. */
export function isClaimActive(claimedAt: string | null, expiryMinutes: number, nowMs: number): boolean {
  if (!claimedAt) return false
  const claimedMs = Date.parse(claimedAt)
  if (Number.isNaN(claimedMs)) return false
  return (nowMs - claimedMs) < (expiryMinutes * 60_000)
}

/** Estado del claim relativo a mí. 'others' = tomada por otra persona y vigente. */
export function resolveClaimState(
  row: ClaimRow, myUserId: string, expiryMinutes: number, nowMs: number,
): { state: ClaimState; byName: string | null; heldMinutes: number | null } {
  if (!row.claimed_by || !isClaimActive(row.claimed_at, expiryMinutes, nowMs)) {
    return { state: 'free', byName: null, heldMinutes: null }
  }
  if (row.claimed_by === myUserId) {
    return { state: 'mine', byName: row.claimed_by_name, heldMinutes: null }
  }
  const heldMinutes = row.claimed_at ? Math.floor((nowMs - Date.parse(row.claimed_at)) / 60_000) : null
  return { state: 'others', byName: row.claimed_by_name, heldMinutes }
}
```

- [ ] **Step 4: Correr los tests (pasan)**

Run: `npx tsx scripts/test-claim-logic.ts`
Expected: `Resultado: 20 ✅ / 0 ❌`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules/claim-logic.ts scripts/test-claim-logic.ts
git commit -m "feat(claim): lógica pura de config, vencimiento y estado + 20 tests"
```

---

### Task 3: Server actions — claim / release / override

**Files:**
- Create: `src/app/actions/claim.ts`

**Interfaces:**
- Consumes: `parseClaimConfig`, `resolveClaimState` (Task 2); `getUserSession` (`@/lib/session` → `{ clinicId, clinicUserId, fullName, permissions }`); `checkWritePermission` (`@/lib/actions-helpers`); `supabaseAdmin` (`@/lib/supabase/admin`).
- Produces:
  - `claimConversation(conversationId: string): Promise<{ ok: boolean; error?: string; state?: 'free'|'mine'|'others'; byName?: string | null; enabled?: boolean }>`
  - `releaseConversation(conversationId: string): Promise<{ ok: boolean; error?: string }>`
  - `overrideClaim(conversationId: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Implementar las 3 actions**

```ts
// src/app/actions/claim.ts
'use server'

// Pieza A — Claim de conversaciones. Gate conversations.write. Filtra por clinic_id.
// Vencimiento se computa al leer (parseClaimConfig + resolveClaimState). Sin cron.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, extractActionError } from '@/lib/actions-helpers'
import { getUserSession } from '@/lib/session'
import { parseClaimConfig, resolveClaimState } from '@/lib/rules/claim-logic'
import { revalidatePath } from 'next/cache'

interface ConvClaimRow {
  clinic_id: string
  claimed_by: string | null
  claimed_by_name: string | null
  claimed_at: string | null
}

async function loadConv(conversationId: string, clinicId: string): Promise<ConvClaimRow | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('clinic_id, claimed_by, claimed_by_name, claimed_at')
    .eq('id', conversationId)
    .maybeSingle()
  const row = data as ConvClaimRow | null
  if (!row || row.clinic_id !== clinicId) return null
  return row
}

async function loadClaimConfig(clinicId: string) {
  const { data } = await supabaseAdmin.from('clinics').select('feature_config').eq('id', clinicId).single()
  return parseClaimConfig((data as { feature_config: unknown } | null)?.feature_config)
}

/** Auto-claim al abrir. Toma si está libre/vencida/propia; si es de otra vigente, NO toma. */
export async function claimConversation(conversationId: string) {
  let clinicId: string
  try { clinicId = await checkWritePermission('conversations') }
  catch (err) { return { ok: false, error: extractActionError(err) } }
  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const config = await loadClaimConfig(clinicId)
  if (!config.enabled) return { ok: true, enabled: false, state: 'free' as const }

  const conv = await loadConv(conversationId, clinicId)
  if (!conv) return { ok: false, error: 'Conversación no encontrada' }

  const { state } = resolveClaimState(conv, session.clinicUserId, config.expiryMinutes, Date.now())
  if (state === 'others') {
    return { ok: true, enabled: true, state, byName: conv.claimed_by_name }
  }
  // free | mine → tomar / refrescar
  await supabaseAdmin
    .from('conversations')
    .update({ claimed_by: session.clinicUserId, claimed_by_name: session.fullName, claimed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
  return { ok: true, enabled: true, state: 'mine' as const, byName: session.fullName }
}

/** Soltar la propia (o cualquiera; idempotente). */
export async function releaseConversation(conversationId: string) {
  let clinicId: string
  try { clinicId = await checkWritePermission('conversations') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  const { error } = await supabaseAdmin
    .from('conversations')
    .update({ claimed_by: null, claimed_by_name: null, claimed_at: null })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
  if (error) return { ok: false, error: 'Error liberando la conversación' }
  revalidatePath('/dashboard/conversations')
  return { ok: true }
}

/** "Tomar de todos modos" (escape del modo duro). Transfiere + AUDITA quién sacó a quién. */
export async function overrideClaim(conversationId: string) {
  let clinicId: string
  try { clinicId = await checkWritePermission('conversations') }
  catch (err) { return { ok: false, error: extractActionError(err) } }
  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const conv = await loadConv(conversationId, clinicId)
  if (!conv) return { ok: false, error: 'Conversación no encontrada' }

  const heldMinutes = conv.claimed_at ? Math.floor((Date.now() - Date.parse(conv.claimed_at)) / 60_000) : null

  await supabaseAdmin
    .from('conversations')
    .update({ claimed_by: session.clinicUserId, claimed_by_name: session.fullName, claimed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)

  // Invariante: el override SIEMPRE se audita (la otra mitad de sender_name).
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: clinicId,
    action: 'conversation_claim_override',
    actor_type: 'staff',
    actor_id: session.clinicUserId,
    target_type: 'conversation',
    target_id: conversationId,
    details: { from_user_id: conv.claimed_by, from_user_name: conv.claimed_by_name, minutes_held: heldMinutes },
  })

  revalidatePath('/dashboard/conversations')
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Verificación funcional contra prod (datos de prueba, limpiar después)**

Con una conversación de prueba de Algia (crear una si hace falta, marcarla `status='escalated'`), verificar por SQL tras invocar las actions vía la UI (Task 4) o un script: `claimConversation` setea `claimed_by`; segunda llamada con OTRO `clinicUserId` con claim vigente NO cambia `claimed_by`; `overrideClaim` cambia `claimed_by` e inserta 1 fila `conversation_claim_override` en `audit_log`; `releaseConversation` deja los 3 campos NULL. Limpiar la conversación de prueba al terminar.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/claim.ts
git commit -m "feat(claim): server actions claim/release/override con audit del override"
```

---

### Task 4: Chat — auto-claim, banner, lock del modo duro, escape

**Files:**
- Modify: `src/app/dashboard/conversations/[id]/page.tsx` (server: cargar claim + config, pasar props)
- Modify: `src/components/dashboard/conversation-chat.tsx` (cliente: auto-claim, banner, lock, override, realtime)

**Interfaces:**
- Consumes: `claimConversation`, `releaseConversation`, `overrideClaim` (Task 3); `parseClaimConfig`, `resolveClaimState`, type `ClaimRow`, `ClaimConfig` (Task 2).
- La página YA calcula (líneas ~120-129): `canWrite = session.permissions.conversations?.write`, `staffName`, y pasa `conversation`, `initialMessages`, `canWrite`, `staffName`, `nextAppointment` a `<ConversationChat>`.

- [ ] **Step 1: En la página de detalle, cargar claim + config y pasarlos**

En `[id]/page.tsx`: la query de la conversación debe incluir `claimed_by, claimed_by_name, claimed_at`. Calcular `const claimConfig = parseClaimConfig(clinic.feature_config)` (cargar `feature_config` de la clínica si no está ya). Pasar props nuevos a `<ConversationChat>`:
```tsx
claimConfig={claimConfig}
claim={{ claimed_by: conv.claimed_by, claimed_by_name: conv.claimed_by_name, claimed_at: conv.claimed_at }}
myClinicUserId={session.clinicUserId}
```

- [ ] **Step 2: Extender Props + estado en `conversation-chat.tsx`**

En el `interface Props` agregar `claimConfig: ClaimConfig`, `claim: ClaimRow`, `myClinicUserId: string`. Importar de `@/lib/rules/claim-logic` (`resolveClaimState`, tipos) y las 3 actions de `@/app/actions/claim`. Estado local: `const [claim, setClaim] = useState<ClaimRow>(props.claim)`.

- [ ] **Step 3: Auto-claim al montar (si enabled)**

```tsx
useEffect(() => {
  if (!claimConfig.enabled) return
  claimConversation(conversation.id).then((r) => {
    if (r.ok && r.state === 'mine') {
      setClaim({ claimed_by: myClinicUserId, claimed_by_name: staffName, claimed_at: new Date().toISOString() })
    }
    // si r.state==='others' NO tomamos; el banner ya lo refleja desde props/realtime
  }).catch(() => {})
}, [conversation.id])
```

- [ ] **Step 4: Leer claim en el handler de Realtime existente**

En el `.on('postgres_changes', { event: 'UPDATE', table: 'conversations', filter: id })` que hoy solo lee `status` (líneas ~126-133), agregar la lectura de los 3 campos de claim y `setClaim(...)`. Así "María tomó / liberó / hizo override" se propaga en vivo al chat abierto.

- [ ] **Step 5: Computar estado y renderizar banner + escape**

```tsx
const claimState = resolveClaimState(claim, myClinicUserId, claimConfig.expiryMinutes, Date.now())
const lockedByOther = claimConfig.enabled && claimConfig.mode === 'hard' && claimState.state === 'others'
```
- Banner encima del input: `mine` → "La estás atendiendo vos" + botón "Liberar" (`releaseConversation`); `others` → "🙋 {byName} está atendiendo (hace {heldMinutes} min)". En modo duro y `others`, además botón **"Tomar de todos modos"** → `window.confirm('{byName} tiene esta conversación tomada. ¿Entrar igual?')` → `overrideClaim(conversation.id)` → `setClaim` a mí. Este botón es OBLIGATORIO (invariante: siempre hay salida).
- `<textarea>` (línea ~426) y botón de envío (línea ~438): agregar `|| lockedByOther` a su `disabled`. En modo blando NUNCA se deshabilita.

- [ ] **Step 6: Verificación manual (build + navegador)**

Run: `npm run build` (Expected: sin errores). Luego en `/dashboard/conversations/<id>` de prueba:
- Modo blando: abrir → "La estás atendiendo vos"; desde otra sesión/usuario, banner "🙋 X está atendiendo", input SIGUE habilitado.
- Modo duro (setear `feature_config.claim.mode='hard'` en la clínica de prueba): input DESHABILITADO para la otra persona + botón "Tomar de todos modos" → confirma → input habilitado + fila en `audit_log`.
- Toggle OFF (`enabled=false`): sin banner, sin lock, idéntico a hoy.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/conversations/[id]/page.tsx src/components/dashboard/conversation-chat.tsx
git commit -m "feat(claim): chat — auto-claim, banner, lock del modo duro con escape auditado"
```

---

### Task 5: Lista — badge "Tomada por X"

**Files:**
- Modify: `src/app/dashboard/conversations/page.tsx` (query: incluir claim; pasar `expiryMinutes`)
- Modify: `src/components/dashboard/conversations-panel.tsx` (tipo `ConversationEntry` + badge)

**Interfaces:**
- Consumes: `resolveClaimState`, `parseClaimConfig` (Task 2).
- La lista YA recarga en cualquier cambio de `conversations` vía Realtime (`conv-list-realtime`, `window.location.reload()` en líneas 59-74) → el badge se actualiza solo.

- [ ] **Step 1: Query de la lista incluye claim + pasar expiry**

En `conversations/page.tsx`: agregar `claimed_by, claimed_by_name, claimed_at` al `.select(...)` (línea ~35). Calcular `const claimConfig = parseClaimConfig(clinic.feature_config)`. En el armado de cada `ConversationEntry`, computar el estado con `resolveClaimState({claimed_by, claimed_by_name, claimed_at}, session.clinicUserId, claimConfig.expiryMinutes, Date.now())` y setear `claimed_by_name_active = state==='others' ? byName : (state==='mine' ? 'vos' : null)`. Pasar ese campo derivado en la entry (así el vencimiento ya viene resuelto y el cliente no recomputa el reloj).

- [ ] **Step 2: `ConversationEntry` + badge**

En `conversations-panel.tsx`, agregar a la interfaz `ConversationEntry` el campo `claimed_active_label: string | null` (null = libre). En el render del item de lista (dentro del `<Link href={...}>`, ~línea 188), si `entry.claimed_active_label` no es null, mostrar un badge chico "🙋 Tomada por {label}" (si label==='vos' → "🙋 La atiendes vos").

- [ ] **Step 3: Verificación manual**

Run: `npm run build`. En `/dashboard/conversations`: tomar una conversación desde el detalle → volver a la lista → badge "🙋 Tomada por {nombre}" visible; con `feature_config.claim.enabled=false`, sin badges.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/conversations/page.tsx src/components/dashboard/conversations-panel.tsx
git commit -m "feat(claim): badge 'Tomada por X' en la lista de conversaciones"
```

---

### Task 6: Panel "Equipo" — bloque Coordinación (config de claim)

**Files:**
- Create: `src/app/actions/team-config.ts` (`updateClaimConfig`)
- Create: `src/components/dashboard/claim-config-form.tsx` (form cliente)
- Modify: el panel de usuarios (`/dashboard/configuracion/usuarios` — ubicar el `page.tsx` real) para renombrar el encabezado a "Equipo" y montar el bloque Coordinación arriba de la lista de usuarios.

**Interfaces:**
- Consumes: `parseClaimConfig`, type `ClaimConfig` (Task 2); `getUserSession`; el MISMO gate de escritura que ya usan las acciones del panel de usuarios (buscarlo en `src/app/actions/users.ts`; NO inventar uno).
- Produces: `updateClaimConfig(config: ClaimConfig): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Server action `updateClaimConfig` (merge JSONB, no clobber)**

```ts
// src/app/actions/team-config.ts
'use server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { extractActionError } from '@/lib/actions-helpers'
import type { ClaimConfig } from '@/lib/rules/claim-logic'
import { revalidatePath } from 'next/cache'
// IMPORTAR el gate real que usa el panel de usuarios (ver src/app/actions/users.ts) y usarlo acá.

export async function updateClaimConfig(config: ClaimConfig): Promise<{ ok: boolean; error?: string }> {
  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }
  // GATE: reemplazar por el mismo checkWritePermission('<módulo>') que usan las actions de users.ts.
  // ... gate ...

  if (config.mode !== 'soft' && config.mode !== 'hard') return { ok: false, error: 'Modo inválido' }
  if (!Number.isFinite(config.expiryMinutes) || config.expiryMinutes <= 0) return { ok: false, error: 'Vencimiento inválido' }

  // MERGE, no clobber: preservar otras claves de feature_config y de feature_config.claim (ej. las de B a futuro).
  const { data: clinic } = await supabaseAdmin.from('clinics').select('feature_config').eq('id', session.clinicId).single()
  const fc = ((clinic as { feature_config: Record<string, unknown> | null } | null)?.feature_config) ?? {}
  const prevClaim = (fc.claim && typeof fc.claim === 'object') ? fc.claim as Record<string, unknown> : {}
  const nextFc = { ...fc, claim: { ...prevClaim, enabled: config.enabled, mode: config.mode, expiry_minutes: config.expiryMinutes } }

  const { error } = await supabaseAdmin.from('clinics').update({ feature_config: nextFc }).eq('id', session.clinicId)
  if (error) return { ok: false, error: 'Error guardando la configuración' }
  revalidatePath('/dashboard/configuracion/usuarios')
  return { ok: true }
}
```

- [ ] **Step 2: Form cliente `ClaimConfigForm`**

Componente `'use client'` que recibe `initial: ClaimConfig`. Controles: toggle `enabled`; radios `mode` (Blando / Duro) con ayuda ("Duro bloquea el campo de respuesta a las demás; siempre pueden 'tomar de todos modos'"); input numérico `expiry_minutes` (min 1). Botón Guardar → `updateClaimConfig(...)` con toast de éxito/error. Deshabilitar los controles de modo/vencimiento cuando `enabled=false` (visualmente, pero se guardan igual).

- [ ] **Step 3: Montar en el panel, renombrar a "Equipo"**

En el `page.tsx` del panel de usuarios: cargar `parseClaimConfig(clinic.feature_config)` (server) y renderizar `<ClaimConfigForm initial={...} />` en un bloque "Coordinación" ARRIBA de la lista de usuarios. Cambiar el título de la página a "Equipo". Dejar la lista de usuarios como está (Pieza B le agrega especialidades después).

- [ ] **Step 4: Verificación manual**

Run: `npm run build`. En `/dashboard/configuracion/usuarios`: cambiar modo a Duro + vencimiento a 5 → Guardar → verificar por SQL que `clinics.feature_config.claim = {enabled, mode:'hard', expiry_minutes:5}` SIN perder otras claves de `feature_config` (ej. `media_reception_enabled`, `agent`). Toggle OFF → el chat/lista dejan de mostrar claim.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/team-config.ts src/components/dashboard/claim-config-form.tsx src/app/dashboard/configuracion/usuarios/
git commit -m "feat(claim): panel Equipo — bloque Coordinación con config de claim (merge no-clobber)"
```

---

## Self-Review

**1. Spec coverage** (Pieza A del spec):
- Schema `conversations` +3 cols → Task 1. ✅
- Config `feature_config.claim` (enabled/mode/expiry_minutes, defaults) → Task 2 (`parseClaimConfig`) + Task 6 (guardar). ✅
- `claimConversation`/`releaseConversation`/`overrideClaim` → Task 3. ✅
- Auto-claim al abrir → Task 4 Step 3. ✅
- Vencimiento al leer, sin cron → Task 2 (`isClaimActive`), usado en Tasks 3/4/5. ✅
- Modo blando (banner) / duro (lock + escape) → Task 4 Step 5. ✅
- Escape "tomar de todos modos" con confirmación → Task 4 Step 5. ✅ (invariante "siempre hay salida")
- Audit del override → Task 3 (`overrideClaim` + `conversation_claim_override`). ✅ (invariante)
- Toggle OFF = comportamiento actual → Task 3 (`enabled=false` no-op) + Task 4/5 (banners/lock gated por `enabled`). ✅
- Display en lista + header del chat → Tasks 5 y 4. ✅
- Realtime existente → Tasks 4 Step 4 (chat) y 5 (lista, reload). ✅
- Botón "Liberar" → Task 4 Step 5. ✅
- Config UI en panel "Equipo" → Task 6. ✅
- Pieza B (especialidades) NO incluida → correcto, es plan aparte. ✅

**2. Placeholder scan:** El único "… gate …" en Task 6 Step 1 es intencional y explícito (instrucción de reusar el gate real de `users.ts`, no inventarlo) — no es un placeholder de lógica faltante. Resto sin TBD/TODO.

**3. Type consistency:** `ClaimConfig`/`ClaimRow`/`ClaimState`/`resolveClaimState`/`parseClaimConfig`/`isClaimActive` usados con las mismas firmas en Tasks 2→3→4→5→6. `expiry_minutes` (snake, en JSONB/config guardada) vs `expiryMinutes` (camel, en el tipo TS) — consistente: `parseClaimConfig` traduce uno al otro. `conversation_claim_override` con el mismo shape de `details` en action y en el criterio de verificación.
