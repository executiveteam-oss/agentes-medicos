# Capa 0 de Seguridad — Detección de crisis + pedido de humano — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una capa de seguridad determinista al webhook de WhatsApp que detecta crisis (suicidio/autolesión) y pedidos explícitos de humano ANTES de todo el pipeline, responde con contención + escala + alerta 🆘 inconfundible, y arregla la "zona muerta" de conversaciones ya escaladas.

**Architecture:** Dos detectores puros por regex (`crisis-patterns.ts`), config con Zod (`crisis-config.ts`), una migración (nuevo tipo de notificación + columna de refresco), dos helpers de notificación (`notifyCrisis` que rompe idempotencia + `refreshEscalationNotifications`), el cableado en el webhook (bloque Capa 0 antes de la regla 15 + refresco en la regla 15), y el render 🆘 en la campana. La detección NO depende del LLM.

**Tech Stack:** Next.js 14 App Router, TypeScript estricto, Supabase (Postgres), Zod, `npx tsx` para tests de scripts.

## Global Constraints

- TypeScript estricto. Sin `any`. Comentarios/UI en español.
- Tests corren con `npx tsx scripts/<archivo>.ts` y el criterio de éxito es la línea final `Resultado: N ✅ / 0 ❌` (0 fallidos). Estilo: `let passed = 0, failed = 0` + `function assert(label, ok, detail?)`.
- **Principio rector (del spec §3): ante ambigüedad, SOBRE-DETECTAR crisis.** Un caso ambiguo (`me quiero morir` sin calificador) va al lado de crisis. Solo es modismo con un calificador inequívoco (`de la pena`, `por un café`).
- **Las keywords de crisis viven en código** (`crisis-patterns.ts`), NO en config por-clínica. Solo el mensaje de contención y la línea de ayuda son configurables.
- **GATE DE ACTIVACIÓN — Opción B (dos niveles), CONFIRMADA por el usuario (spec §8):**
  - `detection_enabled` (default `true`): detectar + escalar + alertar 🆘 al staff. Puro upside, arranca activo.
  - `auto_message_approved` (default `false`): enviar el mensaje automático de contención al paciente. Solo `true` cuando Algia valida el wording clínicamente.
  - *Si el usuario elige la Opción A (gate único), el único cambio es: en `handleCrisis`, envolver TODO (detección incluida) bajo un solo `enabled` flag. No afecta las Tasks 1-4.*
- **NUNCA se envía un mensaje de crisis real a un paciente real en ningún test.** El smoke (Task 7) forja el mensaje entrante desde el número PROPIO del tester (allowlisteado), de modo que cualquier respuesta solo llega a ese número.
- El wording de contención default (106 + 123) es **borrador pendiente de validación clínica de Algia** — piso solo para tests, no texto final de producción.

---

### Task 1: Detectores puros de crisis y pedido de humano

**Files:**
- Create: `src/lib/safety/crisis-patterns.ts`
- Test: `scripts/test-crisis-detection.ts`

**Interfaces:**
- Consumes: nada (módulo puro, sin imports del proyecto).
- Produces:
  - `normalizeForSafety(text: string): string`
  - `detectCrisis(text: string): { matched: boolean; pattern?: string }`
  - `detectHumanRequest(text: string): { matched: boolean; pattern?: string }`

- [ ] **Step 1: Escribir el test que falla**

Crear `scripts/test-crisis-detection.ts`:

```ts
import { detectCrisis, detectHumanRequest, normalizeForSafety } from '../src/lib/safety/crisis-patterns'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests Capa 0 — detección de crisis\n')

// --- normalizeForSafety ---
assert('normaliza acentos/mayúsculas', normalizeForSafety('ME QUIERO MORÍR') === 'me quiero morir')
assert('colapsa letras repetidas', normalizeForSafety('holaaaa') === 'hola')
assert('quita puntuación', normalizeForSafety('¡me quiero morir!!!') === 'me quiero morir')

// --- CRISIS: positivos directos (DEBEN disparar) ---
const crisisPos = [
  'Me quiero suicidar, que hago',        // mensaje real del incidente
  'estoy pensando en suicidarme',
  'quiero suicidarme',
  'suisidio',                             // typo
  'quiero matarme',
  'me voy a matar',
  'quiero quitarme la vida',
  'ya no quiero vivir',
  'no quiero seguir viviendo',
  'no le veo sentido a la vida',
  'prefiero estar muerto',
  'estaria mejor muerto',
  'quiero hacerme daño',
  'pienso en cortarme las venas',
  'quiero autolesionarme',
]
for (const t of crisisPos) assert(`CRISIS+ "${t}"`, detectCrisis(t).matched, 'no disparó')

// --- CRISIS: AMBIGUOS → lado crisis (principio rector, DEBEN disparar) ---
const crisisAmbiguo = [
  'me quiero morir',
  'quiero morir',
  'ya no aguanto mas',
  'no quiero seguir aca',        // bare → crisis
]
for (const t of crisisAmbiguo) assert(`CRISIS-ambiguo+ "${t}"`, detectCrisis(t).matched, 'ambiguo debe ir a crisis')

// --- CRISIS: negativos (modismos con calificador, NO deben disparar) ---
const crisisNeg = [
  'me quiero morir de la pena',
  'me quiero morir de la verguenza',
  'que pena tan berraca',
  'me muero por un cafe',
  'me muero por verte',
  'matar el tiempo',
  'me esta matando el trabajo',
  'me esta matando la espalda',
  'me mata la curiosidad',
  'morirse de risa',
  'morirse del susto',
  'morirse del aburrimiento',
  'morirse de las ganas',
  'me muero de risa',
  'me muero de hambre',
  'me muero de sueno',
  'me muero de frio',
  'me matas de risa',
  'esto me mata',
  'me duele la cabeza',
  'es un dolor mortal',
  'morir de amor',
  'necesito una cita de ginecologia',
  'no quiero seguir aca en la fila',   // continuación inocua → NO crisis
  'la escala del dolor llego a 8',     // "escala" médica → NO pedido de humano ni crisis
]
for (const t of crisisNeg) assert(`CRISIS- "${t}"`, !detectCrisis(t).matched, 'FALSO POSITIVO')

// --- HUMANO: positivos (DEBEN disparar) ---
const humanPos = [
  'Escala a humano',                     // incidente
  'Humano',                              // incidente ("Humano*" → sanitizado)
  'necesito hablar con una persona',
  'quiero un asesor',
  'pasame con alguien del consultorio',
  'necesito una persona real',
  'quiero escalar con un humano',
]
for (const t of humanPos) assert(`HUMANO+ "${t}"`, detectHumanRequest(t).matched, 'no disparó')

// --- HUMANO: negativos (NO deben disparar) ---
const humanNeg = [
  'soy una persona mayor',
  'busco cita para persona de la tercera edad',
  'hola buenas',
  'quiero agendar una cita',
  'la escala del dolor llego a 8',       // "escala" médica, NO pedido de humano
  'en que escala miden el dolor',
]
for (const t of humanNeg) assert(`HUMANO- "${t}"`, !detectHumanRequest(t).matched, 'FALSO POSITIVO')

// --- Precedencia: crisis gana sobre humano ---
assert('crisis gana sobre humano', detectCrisis('me quiero suicidar, pasame con un humano').matched === true)

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx tsx scripts/test-crisis-detection.ts`
Expected: FALLA con error de módulo no encontrado (`Cannot find module '../src/lib/safety/crisis-patterns'`).

- [ ] **Step 3: Implementar `crisis-patterns.ts`**

Crear `src/lib/safety/crisis-patterns.ts`:

```ts
// ============================================================
// Capa 0 de seguridad — detectores deterministas (puros, sin DB/red).
// Principio: ante ambigüedad, SOBRE-DETECTAR crisis. Un caso sin calificador
// inequívoco de modismo va al lado de crisis. Ver spec §3/§6.
// Las keywords viven acá (código), NO en config por-clínica.
// ============================================================

/** Normaliza para matchear: minúsculas, sin acentos, sin puntuación,
 *  colapsa espacios y letras repetidas (3+). Tolera tildes/mayúsculas/typos. */
export function normalizeForSafety(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // quitar diacríticos
    .replace(/(.)\1{2,}/g, '$1')      // colapsar 3+ repeticiones (holaaa → hola)
    .replace(/[^\w\s]/g, ' ')         // puntuación → espacio
    .replace(/\s+/g, ' ')
    .trim()
}

// Cola de modismo que DESACTIVA el match de "morir" (calificador inequívoco).
const IDIOM_TAIL = '(?! (de (la |el |las |los )?(pena|verguenza|risa|susto|aburrimiento|ganas|hambre|sueno|frio|calor|sed|amor|miedo|nervios)|por ))'

// Patrones de crisis. Cada uno corre sobre el texto YA normalizado.
const CRISIS_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(suicid|suisid)/, label: 'suicidio' },
  { re: new RegExp(`\\b(matarme|me mato|me voy a matar|me quiero matar|quiero matarme)\\b(?! de )`), label: 'matarse' },
  { re: new RegExp(`\\b(me )?(quiero|quisiera) morir(me)?\\b${IDIOM_TAIL}`), label: 'quiero morir' },
  { re: /\b(quitarme la vida|acabar con mi vida|terminar con mi vida|acabar con todo)\b/, label: 'quitarse la vida' },
  { re: /\b(no quiero vivir|no quiero seguir viviendo|ya no quiero vivir|no vale la pena vivir|no le veo sentido a (la vida|nada|vivir))\b/, label: 'no quiero vivir' },
  { re: /\b(mejor muerto|estaria mejor muerto|prefiero estar muerto|estarian mejor sin mi)\b/, label: 'mejor muerto' },
  { re: /\b(hacerme dano|lastimarme|autolesi|cortarme (las venas|los brazos))\b/, label: 'autolesion' },
  { re: /\b(ya no aguanto mas|desaparecer para siempre)\b/, label: 'indirecto' },
  // "no quiero seguir aca" (bare) = crisis (ambiguo → crisis). Se excluye solo
  // la continuación claramente inocua ("...en la fila", "...esperando").
  { re: /\bno quiero seguir aca\b(?! (en (la |esta )?fila|esperando|haciendo fila))/, label: 'indirecto-aca' },
]

const HUMAN_REQUEST_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(humano|ser humano|agente humano)\b/, label: 'humano' },
  { re: /\b(persona real|una persona|con una persona|con alguien real|alguien del consultorio)\b/, label: 'persona' },
  { re: /\b(hablar con alguien|hablar con una persona|pasame con|comunicarme con alguien)\b/, label: 'hablar con alguien' },
  { re: /\b(asesor|secretaria)\b/, label: 'asesor' },
  // "escalar" solo con intención de transferencia — NO la palabra "escala"
  // suelta ("escala del dolor" es frecuente en una clínica de dolor pélvico).
  { re: /\bescala(r)? a (un |una )?(humano|persona|asesor|alguien|secretaria)\b/, label: 'escalar a' },
]

export function detectCrisis(text: string): { matched: boolean; pattern?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label } of CRISIS_PATTERNS) {
    if (re.test(n)) return { matched: true, pattern: label }
  }
  return { matched: false }
}

export function detectHumanRequest(text: string): { matched: boolean; pattern?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label } of HUMAN_REQUEST_PATTERNS) {
    if (re.test(n)) return { matched: true, pattern: label }
  }
  return { matched: false }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx tsx scripts/test-crisis-detection.ts`
Expected: `Resultado: N ✅ / 0 ❌` (exit 0). Si algún modismo da falso positivo o algún ambiguo no dispara, ajustar el patrón correspondiente hasta 0 fallidos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/safety/crisis-patterns.ts scripts/test-crisis-detection.ts
git commit -m "feat(seguridad): detectores puros de crisis y pedido de humano (Capa 0)"
```

---

### Task 2: Config de crisis (Zod + mensaje de contención)

**Files:**
- Create: `src/lib/safety/crisis-config.ts`
- Modify: `src/types/database.ts:101-106` (agregar `crisis` a `WhatsAppConfig`)
- Test: `scripts/test-crisis-config.ts`

**Interfaces:**
- Produces:
  - `type CrisisConfig = { detection_enabled: boolean; auto_message_approved: boolean; containment_message: string; human_handoff_message: string }`
  - `DEFAULT_CRISIS_CONFIG: CrisisConfig`
  - `crisisConfigSchema` (Zod)
  - `buildContainmentMessage(config: CrisisConfig, patientFirstName?: string): string`

- [ ] **Step 1: Escribir el test que falla**

Crear `scripts/test-crisis-config.ts`:

```ts
import { buildContainmentMessage, DEFAULT_CRISIS_CONFIG, crisisConfigSchema } from '../src/lib/safety/crisis-config'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests Capa 0 — config de crisis\n')

assert('default: detection ON', DEFAULT_CRISIS_CONFIG.detection_enabled === true)
assert('default: auto_message NO aprobado', DEFAULT_CRISIS_CONFIG.auto_message_approved === false)
assert('default: contención menciona 106', DEFAULT_CRISIS_CONFIG.containment_message.includes('106'))
assert('default: contención menciona 123', DEFAULT_CRISIS_CONFIG.containment_message.includes('123'))

const msg = buildContainmentMessage(DEFAULT_CRISIS_CONFIG, 'Ana')
assert('interpola {nombre}', msg.includes('Ana') || !DEFAULT_CRISIS_CONFIG.containment_message.includes('{nombre}'))
assert('sin placeholder crudo', !msg.includes('{nombre}'))

const parsed = crisisConfigSchema.safeParse({
  detection_enabled: true, auto_message_approved: true,
  containment_message: 'texto', human_handoff_message: 'texto',
})
assert('zod acepta config válida', parsed.success === true)
const bad = crisisConfigSchema.safeParse({ detection_enabled: 'no' })
assert('zod rechaza config inválida', bad.success === false)

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx tsx scripts/test-crisis-config.ts`
Expected: FALLA con `Cannot find module '../src/lib/safety/crisis-config'`.

- [ ] **Step 3: Implementar `crisis-config.ts`**

Crear `src/lib/safety/crisis-config.ts`:

```ts
// ============================================================
// Config de crisis (por-clínica, en clinics.whatsapp_config.crisis).
// El wording de contención es BORRADOR pendiente de validación clínica de
// Algia (spec §8). El default 106+123 es piso para tests, no texto final.
// ============================================================
import { z } from 'zod'

export const crisisConfigSchema = z.object({
  detection_enabled: z.boolean(),
  auto_message_approved: z.boolean(),
  containment_message: z.string().min(1),
  human_handoff_message: z.string().min(1),
})

export type CrisisConfig = z.infer<typeof crisisConfigSchema>

export const DEFAULT_CRISIS_CONFIG: CrisisConfig = {
  detection_enabled: true,       // detectar + escalar + alertar SIEMPRE
  auto_message_approved: false,  // NO enviar contención hasta validación clínica de Algia
  containment_message:
    'Lamento mucho que estés pasando por esto, y me importa. No estás solo/a. ' +
    'Por favor comunícate ahora con la Línea 106 (salud mental, gratuita, 24/7) ' +
    'o llama al 123 si estás en peligro inmediato. Una persona del consultorio ' +
    'va a contactarte lo antes posible. 🙏',
  human_handoff_message:
    'Con gusto te paso con una persona del consultorio. Ya te contactan. 🙏',
}

/** Construye el mensaje de contención. Interpola {nombre} si viene. */
export function buildContainmentMessage(config: CrisisConfig, patientFirstName?: string): string {
  const nombre = (patientFirstName ?? '').trim().split(' ')[0] || ''
  return config.containment_message.replace(/\{nombre\}/g, nombre).replace(/\s{2,}/g, ' ').trim()
}
```

- [ ] **Step 4: Agregar `crisis` al tipo `WhatsAppConfig`**

En `src/types/database.ts`, importar el tipo y agregar el campo opcional. Reemplazar el bloque de `WhatsAppConfig` (líneas 101-106) por:

```ts
export interface WhatsAppConfig {
  schedule: WhatsAppScheduleConfig
  appointment: WhatsAppAppointmentConfig
  escalation_keywords: string[]
  doctors: Record<string, WhatsAppDoctorConfig>  // doctor_id → config
  automations: WhatsAppAutomations
  crisis?: import('@/lib/safety/crisis-config').CrisisConfig  // Capa 0 (opcional; default en getWhatsAppConfig)
}
```

- [ ] **Step 5: Correr el test y typecheck**

Run: `npx tsx scripts/test-crisis-config.ts`
Expected: `Resultado: N ✅ / 0 ❌`.
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/safety/crisis-config.ts scripts/test-crisis-config.ts src/types/database.ts
git commit -m "feat(seguridad): config de crisis (Zod) + mensaje de contención borrador"
```

---

### Task 3: Migración — tipo `crisis_detected` + columna `refreshed_at`

**Files:**
- Create: `supabase/migrations/00082_crisis_detection.sql`

**Interfaces:**
- Produces: `staff_notifications.type` acepta `'crisis_detected'`; columna `staff_notifications.refreshed_at TIMESTAMPTZ` nullable.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/00082_crisis_detection.sql`:

```sql
-- ============================================================
-- 00082_crisis_detection.sql
-- Capa 0 de seguridad:
--   - Agrega 'crisis_detected' al CHECK de staff_notifications.type.
--   - Agrega refreshed_at para el fix de "zona muerta" (re-surface).
-- Aplicar con BEGIN/COMMIT explícito.
-- ============================================================
BEGIN;

ALTER TABLE staff_notifications DROP CONSTRAINT IF EXISTS staff_notifications_type_check;
ALTER TABLE staff_notifications ADD CONSTRAINT staff_notifications_type_check
  CHECK (type IN (
    'appointment_canceled',
    'appointment_rescheduled',
    'appointment_moved',
    'conversation_escalated',
    'crisis_detected'
  ));

ALTER TABLE staff_notifications ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ;

COMMIT;
```

- [ ] **Step 2: Verificar el nombre real del constraint antes de aplicar**

Correr contra prod (solo lectura) para confirmar el nombre del constraint (puede diferir de `staff_notifications_type_check`):

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'staff_notifications'::regclass AND contype = 'c';
```
Si el nombre difiere, ajustar el `DROP CONSTRAINT` de la migración al nombre real.

- [ ] **Step 3: Aplicar la migración a prod**

Aplicar vía la herramienta de migraciones de Supabase (MCP `apply_migration` o el flujo del proyecto). Es aditiva y reversible (el CHECK viejo se puede restaurar; la columna se puede dropear).

- [ ] **Step 4: Verificar el schema aplicado**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='staff_notifications' AND column_name='refreshed_at';
-- Debe devolver 1 fila.
INSERT INTO staff_notifications (clinic_id, recipient_user_id, type, title)
VALUES ('dac775fe-6ebd-47e3-89b4-eeb1a821facb',
        (SELECT auth_user_id FROM clinic_users WHERE clinic_id='dac775fe-6ebd-47e3-89b4-eeb1a821facb' LIMIT 1),
        'crisis_detected', 'test constraint') RETURNING id;
-- Debe insertar sin error de CHECK. Luego borrar:
DELETE FROM staff_notifications WHERE title='test constraint';
```
Expected: el INSERT con type `crisis_detected` no viola el CHECK; se borra la fila de prueba.

- [ ] **Step 5: Actualizar el tipo `StaffNotification`**

En `src/lib/notifications/types.ts`, línea 5, agregar `'crisis_detected'` al union, y agregar `refreshed_at` a la interfaz:

```ts
export type NotificationType = 'appointment_canceled' | 'appointment_rescheduled' | 'appointment_moved' | 'conversation_escalated' | 'crisis_detected'
```
Y en `StaffNotification` (después de `created_at: string`):
```ts
  refreshed_at: string | null
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00082_crisis_detection.sql src/lib/notifications/types.ts
git commit -m "feat(seguridad): migración crisis_detected + refreshed_at (Capa 0)"
```

---

### Task 4: Notificaciones — `notifyCrisis` (rompe idempotencia) + `refreshEscalationNotifications`

**Files:**
- Modify: `src/lib/notifications/escalation-notify.ts` (agregar 2 funciones al final)

**Interfaces:**
- Consumes: `createStaffNotification` (existente), `NotificationType` (con `crisis_detected`), `supabaseAdmin`.
- Produces:
  - `notifyCrisis(params: { clinicId: string; conversationId: string; patientName: string | null; patientMessage: string }): Promise<void>` — SIEMPRE inserta (fan-out a staff no-Doctor), sin chequeo de idempotencia.
  - `refreshEscalationNotifications(params: { conversationId: string; clinicId: string; patientName: string | null; latestMessage: string }): Promise<void>` — actualiza las alertas vivas (body + refreshed_at); si no hay ninguna viva, crea una nueva vía `notifyStaffOfEscalation`.

- [ ] **Step 1: Implementar las dos funciones**

Agregar al final de `src/lib/notifications/escalation-notify.ts` (ya importa `supabaseAdmin` y `createStaffNotification`; agregar el import de `notifyStaffOfEscalation` no hace falta porque está en el mismo archivo):

```ts
const MAX_BODY_CRISIS = 120

/**
 * Alerta de CRISIS. Rompe idempotencia a propósito: SIEMPRE inserta una alerta
 * nueva (fan-out a todo el staff no-Doctor), aunque ya haya otra escalación viva.
 * body = el mensaje real del paciente (truncado). Nunca lanza.
 */
export async function notifyCrisis(params: {
  clinicId: string
  conversationId: string
  patientName: string | null
  patientMessage: string
}): Promise<void> {
  const { clinicId, conversationId, patientName, patientMessage } = params
  try {
    const displayName = patientName?.trim() || 'Paciente nuevo'
    const body = patientMessage.trim().length > MAX_BODY_CRISIS
      ? patientMessage.trim().slice(0, MAX_BODY_CRISIS) + '...'
      : patientMessage.trim()
    await createStaffNotification(
      clinicId,
      {
        type: 'crisis_detected',
        title: `🆘 CRISIS — ${displayName}`,
        body,
        metadata: { crisis: true },
        navigateTo: `/dashboard/conversations/${conversationId}`,
      },
      conversationId,
    )
  } catch (err) {
    console.error('[CAPA0] notifyCrisis falló (no crítico):', err)
  }
}

/**
 * Fix de la "zona muerta": ante un mensaje nuevo a una conversación ya escalada,
 * refresca las alertas de escalación vivas (body al último mensaje + refreshed_at)
 * para que re-suban en la campana. Si NO hay ninguna viva (fue atendida pero la
 * conversación sigue escalada), crea una nueva vía notifyStaffOfEscalation.
 * Nunca lanza.
 */
export async function refreshEscalationNotifications(params: {
  conversationId: string
  clinicId: string
  patientName: string | null
  latestMessage: string
}): Promise<void> {
  const { conversationId, clinicId, patientName, latestMessage } = params
  try {
    const body = latestMessage.trim().length > MAX_BODY
      ? latestMessage.trim().slice(0, MAX_BODY) + '...'
      : latestMessage.trim()
    const { data: updated } = await supabaseAdmin
      .from('staff_notifications')
      .update({ body, refreshed_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('type', 'conversation_escalated')
      .is('read_at', null)
      .select('id')

    if (!updated || updated.length === 0) {
      // No hay alerta viva (atendida antes) pero la conversación sigue escalada
      // y el paciente volvió a escribir → crear una nueva.
      await notifyStaffOfEscalation({ clinicId, conversationId, patientName, reason: latestMessage })
    }
  } catch (err) {
    console.error('[CAPA0] refreshEscalationNotifications falló (no crítico):', err)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores. (`createStaffNotification` acepta el nuevo `type` porque Task 3 amplió `NotificationType`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications/escalation-notify.ts
git commit -m "feat(seguridad): notifyCrisis (rompe idempotencia) + refreshEscalationNotifications"
```

---

### Task 5: Cableado en el webhook — bloque Capa 0 + refresco en regla 15

**Files:**
- Modify: `src/app/api/webhooks/whatsapp/route.ts` (bloque Capa 0 tras el paso 14; modificar regla 15; agregar `handleCrisis`/`handleHumanRequest`; agregar `crisis` al DEFAULT de `getWhatsAppConfig`; agregar imports)

**Interfaces:**
- Consumes: `detectCrisis`, `detectHumanRequest` (Task 1); `buildContainmentMessage`, `DEFAULT_CRISIS_CONFIG`, `CrisisConfig` (Task 2); `notifyCrisis`, `refreshEscalationNotifications`, `notifyStaffOfEscalation` (Task 4); `saveMessage`, `sendWhatsAppMessage`, `supabaseAdmin` (existentes).
- En scope en el punto de inserción (tras línea 461): `clinic`, `patient` (`.id`,`.name`), `patientPhone`, `sanitizedText`, `conversation` (`.id`,`.status`), `clinicCreds`, `waConfig`, `message.from`.

- [ ] **Step 1: Agregar imports**

En la cabecera de imports de `route.ts`, agregar:

```ts
import { detectCrisis, detectHumanRequest } from '@/lib/safety/crisis-patterns'
import { buildContainmentMessage, DEFAULT_CRISIS_CONFIG, type CrisisConfig } from '@/lib/safety/crisis-config'
import { notifyCrisis, refreshEscalationNotifications } from '@/lib/notifications/escalation-notify'
```
(`notifyStaffOfEscalation` ya está importado.)

- [ ] **Step 2: Insertar el bloque Capa 0 antes de la regla 15**

En `route.ts`, entre el paso 14 (update de `last_message_at`, ~línea 461) y el paso 15 (`if (conversation.status === 'escalated')`, ~línea 465), insertar:

```ts
      // 14.5. CAPA 0 DE SEGURIDAD — determinista, corre ANTES de la regla 15
      //       (escalada) y del gate de consentimiento (paso 16). No depende del LLM.
      const crisisCfg: CrisisConfig = waConfig.crisis ?? DEFAULT_CRISIS_CONFIG
      if (crisisCfg.detection_enabled) {
        if (detectCrisis(sanitizedText).matched) {
          await handleCrisis(clinic, patient, conversation, message.from, sanitizedText, clinicCreds, crisisCfg)
          return
        }
        if (detectHumanRequest(sanitizedText).matched) {
          await handleHumanRequest(clinic, patient, conversation, message.from, sanitizedText, clinicCreds, crisisCfg)
          return
        }
      }
```

- [ ] **Step 3: Modificar la regla 15 para refrescar (fix zona muerta)**

Reemplazar el cuerpo del `if (conversation.status === 'escalated')` (líneas 466-478) por:

```ts
      if (conversation.status === 'escalated') {
        // Fix zona muerta: refresca la alerta viva con el último mensaje (o crea
        // una nueva si fue atendida). Así la campana refleja lo último que dijo
        // el paciente y re-sube. La crisis ya se manejó arriba en la Capa 0.
        await refreshEscalationNotifications({
          conversationId: conversation.id,
          clinicId: clinic.id,
          patientName: patient.name,
          latestMessage: sanitizedText,
        })
        console.log(`[Webhook] Conversación escalada, no responder (alerta refrescada). ID: ${conversation.id}`)
        return
      }
```

- [ ] **Step 4: Agregar los helpers `handleCrisis` y `handleHumanRequest`**

Agregar (junto a los otros helpers del archivo, ej. cerca de `handleNewPatient`):

```ts
/**
 * Maneja un mensaje de CRISIS detectado por la Capa 0. Detección + escalación +
 * alerta 🆘 SIEMPRE (Opción B). El mensaje de contención al paciente solo se
 * envía si Algia lo aprobó clínicamente (auto_message_approved). Nunca lanza.
 */
async function handleCrisis(
  clinic: Clinic,
  patient: { id: string; name: string | null },
  conversation: { id: string; status: string },
  patientPhone: string,
  patientMessage: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
  crisisCfg: CrisisConfig,
): Promise<void> {
  // 1. Contención al paciente — SOLO si el wording fue aprobado por Algia.
  if (crisisCfg.auto_message_approved) {
    const containment = buildContainmentMessage(crisisCfg, patient.name ?? undefined)
    await saveMessage(conversation.id, 'agent', containment)
    const sentId = await sendWhatsAppMessage(patientPhone, containment, clinicCreds)
    if (!sentId) {
      console.error(`[CAPA0][CRISIS] CRÍTICO: contención NO se envió (conv ${conversation.id})`)
    }
  } else {
    console.warn(`[CAPA0][CRISIS] auto_message_approved=false — no se envía contención, solo alerta al staff (conv ${conversation.id})`)
  }

  // 2. Escalar la conversación (si no lo estaba).
  if (conversation.status !== 'escalated') {
    await supabaseAdmin
      .from('conversations')
      .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: 'crisis' } })
      .eq('id', conversation.id)
  }

  // 3. Alerta 🆘 SIEMPRE (rompe idempotencia).
  await notifyCrisis({ clinicId: clinic.id, conversationId: conversation.id, patientName: patient.name, patientMessage })

  // 4. Audit (sin el texto sensible del paciente).
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinic.id, action: 'crisis_detected', actor_type: 'system',
      details: { urgency: 'emergency' },
    })
  } catch { /* no crítico */ }

  console.log(`[CAPA0][CRISIS] manejada. conv ${conversation.id}`)
}

/**
 * Maneja un pedido EXPLÍCITO de humano detectado por la Capa 0. Escala + avisa.
 * El handoff no tiene gate clínico (no es wording de crisis). Nunca lanza.
 */
async function handleHumanRequest(
  clinic: Clinic,
  patient: { id: string; name: string | null },
  conversation: { id: string; status: string },
  patientPhone: string,
  patientMessage: string,
  clinicCreds: ClinicWhatsAppCredentials | null,
  crisisCfg: CrisisConfig,
): Promise<void> {
  await saveMessage(conversation.id, 'agent', crisisCfg.human_handoff_message)
  await sendWhatsAppMessage(patientPhone, crisisCfg.human_handoff_message, clinicCreds)

  if (conversation.status === 'escalated') {
    await refreshEscalationNotifications({ conversationId: conversation.id, clinicId: clinic.id, patientName: patient.name, latestMessage: patientMessage })
  } else {
    await supabaseAdmin
      .from('conversations')
      .update({ status: 'escalated', escalated_at: new Date().toISOString(), context: { escalation_reason: 'pedido_humano' } })
      .eq('id', conversation.id)
    await notifyStaffOfEscalation({ clinicId: clinic.id, conversationId: conversation.id, patientName: patient.name, reason: patientMessage })
  }
  console.log(`[CAPA0][HUMANO] manejado. conv ${conversation.id}`)
}
```

- [ ] **Step 5: Agregar `crisis` al DEFAULT de `getWhatsAppConfig`**

En `getWhatsAppConfig` (~línea 851), importar el default y agregarlo al objeto `DEFAULT` + al merge. Agregar al import de la cabecera: `import { DEFAULT_CRISIS_CONFIG } from '@/lib/safety/crisis-config'` (ya agregado en Step 1 vía `buildContainmentMessage`… agregar `DEFAULT_CRISIS_CONFIG` a ese import). En el objeto `DEFAULT`, después de `automations: {...}`, agregar:

```ts
    crisis: DEFAULT_CRISIS_CONFIG,
```
Y cambiar el return del merge para incluir crisis con fallback:

```ts
  return { ...DEFAULT, ...raw, automations: { ...DEFAULT.automations, ...(raw.automations ?? {}) }, crisis: { ...DEFAULT_CRISIS_CONFIG, ...(raw.crisis ?? {}) } }
```

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores. Verificar que `Clinic` y `ClinicWhatsAppCredentials` estén importados en `route.ts` (ya lo están; si no, agregarlos).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/webhooks/whatsapp/route.ts
git commit -m "feat(seguridad): cablear Capa 0 en el webhook (antes de regla 15 + consentimiento) + fix zona muerta"
```

---

### Task 6: Campana — render 🆘 CRISIS inconfundible + no-limpiable + orden por refreshed_at

**Files:**
- Modify: `src/components/dashboard/notification-bell.tsx`

**Interfaces:**
- Consumes: `StaffNotification` (con `refreshed_at`, Task 3).

- [ ] **Step 1: Agregar el emoji de crisis**

En `TYPE_EMOJI` (línea ~17-22), agregar:

```ts
  crisis_detected: '🆘',
```

- [ ] **Step 2: Tratar crisis como NO-limpiable (igual que conversation_escalated)**

Reemplazar las 3 condiciones que hoy exceptúan solo `conversation_escalated`:

Línea ~105 (query de `markAllRead`): `.neq('type', 'conversation_escalated')` → agregar exclusión de crisis. Como `.neq` no encadena dos, usar `.not('type', 'in', '("conversation_escalated","crisis_detected")')`:
```ts
      .not('type', 'in', '("conversation_escalated","crisis_detected")')
```
Línea ~107 (estado local de `markAllRead`):
```ts
      n.type === 'conversation_escalated' || n.type === 'crisis_detected' ? n : { ...n, read_at: n.read_at ?? new Date().toISOString() }
```
Línea ~112 (`handleNotifClick`):
```ts
    if (!notif.read_at && notif.type !== 'conversation_escalated' && notif.type !== 'crisis_detected') markAsRead(notif.id)
```

- [ ] **Step 3: Ordenar por refreshed_at (re-surface de alertas refrescadas)**

En el fetch inicial (línea ~43), cambiar el `.order('created_at', ...)` para priorizar `refreshed_at`:
```ts
      .order('refreshed_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
```

- [ ] **Step 4: Estilo rojo inconfundible para crisis**

En el render del item (línea ~206-248), computar una bandera y aplicar fondo/borde rojo + etiqueta "CRISIS". Reemplazar la apertura del `.map` y el `<button>` por:

```tsx
              notifications.slice(0, 10).map((notif) => {
                const isUnread = !notif.read_at
                const isCrisis = notif.type === 'crisis_detected'
                return (
                  <button
                    key={notif.id}
                    onClick={() => handleNotifClick(notif)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--v2-border-soft)',
                      borderLeft: isCrisis ? '4px solid #dc2626' : 'none',
                      background: isCrisis ? '#fef2f2' : (isUnread ? 'var(--v2-primary-tint)' : 'transparent'),
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      fontFamily: 'var(--font-manrope), sans-serif', transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { if (!isUnread && !isCrisis) e.currentTarget.style.background = 'var(--v2-bg-soft)' }}
                    onMouseLeave={(e) => { if (!isUnread && !isCrisis) e.currentTarget.style.background = 'transparent' }}
                  >
```
(Nota: `borderLeft` + `border: 'none'` — dejar `border: 'none'` DESPUÉS de `borderLeft` sobreescribe; en su lugar poner `borderTop/Right/Bottom: 'none'` o usar `outline`. Para evitar el conflicto, quitar `border: 'none'` y usar `borderWidth: 0` salvo el left: reemplazar las dos líneas de border por: `border: 'none', borderLeft: isCrisis ? '4px solid #dc2626' : 'none',` **en ese orden** — `borderLeft` después de `border` gana.)

Y en el título, anteponer la etiqueta "CRISIS" cuando aplique. Reemplazar el `<p>` del título por:

```tsx
                      <p style={{ fontSize: '13px', fontWeight: isCrisis ? 800 : (isUnread ? 700 : 500), color: isCrisis ? '#dc2626' : 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {notif.title}
                      </p>
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.
Run: `npm run build`
Expected: build verde.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/notification-bell.tsx
git commit -m "feat(seguridad): campana pinta 🆘 CRISIS en rojo, no-limpiable, ordena por refreshed_at"
```

---

### Task 7: Smoke E2E seguro + regresión del incidente

**Files:**
- Create: `scripts/smoke-crisis-capa0.ts` (temporal; se borra tras validar)

**Interfaces:**
- Consumes: el webhook desplegado en prod. Requiere el número PROPIO del tester allowlisteado (variable `SMOKE_TESTER_PHONE`).

> ⚠️ Este smoke se corre DESPUÉS de deployar (push a main → Vercel). El "from" es el número propio del tester → cualquier respuesta solo llega a ese número, NUNCA a un paciente real. Para validar el envío real de contención, primero setear `auto_message_approved=true` SOLO para la prueba (o probar el envío contra el propio número), y devolverlo a `false` al terminar.

- [ ] **Step 1: Escribir el smoke**

Crear `scripts/smoke-crisis-capa0.ts` (reusa el patrón de firma HMAC de los probes previos):

```ts
import { existsSync, readFileSync } from 'fs'
import { createHmac } from 'crypto'

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local'); loadEnvFile('.env.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const WEBHOOK_URL = 'https://omuwan.co/api/webhooks/whatsapp'
// Número PROPIO del tester, allowlisteado en el Test Number. Cualquier respuesta
// del agente solo llega acá. NUNCA usar el número de un paciente real.
const TESTER = process.env.SMOKE_TESTER_PHONE ?? '' // ej. 573001112233

async function main() {
  if (!TESTER) { console.error('Setear SMOKE_TESTER_PHONE (número propio allowlisteado)'); process.exit(1) }
  const { createClient } = await import('@supabase/supabase-js')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await supa.from('clinics').select('whatsapp_phone_id, whatsapp_app_secret').eq('id', ALGIA).single()
  const phoneId = clinic!.whatsapp_phone_id as string
  const appSecret = clinic!.whatsapp_app_secret as string

  async function send(text: string, tag: string) {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '000', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '3245820722', phone_number_id: phoneId },
        contacts: [{ profile: { name: 'Smoke Capa0' }, wa_id: TESTER }],
        messages: [{ from: TESTER, id: `wamid.SMOKE_${tag}`, timestamp: '1784668000', type: 'text', text: { body: text } }],
      } }] }],
    })
    const sig = 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex')
    const res = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body })
    console.log(`[${tag}] "${text.slice(0, 40)}" → HTTP ${res.status}`)
  }

  // Caso A: crisis en conversación fresca.
  await send('Hola', 'CONSENT')
  await send('me quiero suicidar, que hago', 'CRISIS_FRESCA')

  // Caso B (regresión del incidente): escalar por pedido humano, LUEGO crisis.
  // La 2da conversación ya está escalada cuando llega la crisis → debe detectarse igual.
  await send('quiero hablar con un humano', 'ESCALA_HUMANO')
  await send('ya no quiero vivir', 'CRISIS_SOBRE_ESCALADA')

  // Verificación en DB
  const { data: conv } = await supa.from('conversations').select('id, status')
    .eq('clinic_id', ALGIA).eq('whatsapp_phone', `+${TESTER}`).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const { count } = await supa.from('staff_notifications').select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv?.id ?? '').eq('type', 'crisis_detected')
  console.log('Conversación:', conv?.id, '| status:', conv?.status, '| alertas crisis:', count)
  console.log('Revisar logs de Vercel: [CAPA0][CRISIS] manejada (x2) — una en conversación fresca, otra sobre escalada.')
  console.log('Número de prueba a limpiar:', TESTER)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Deployar (push a main) y verificar aliasing**

```bash
git push origin main
```
Esperar el deploy READY y confirmar aliasing real a omuwan.co (dominio reasignado al commit + fetch 200), no solo READY.

- [ ] **Step 3: Correr el smoke y leer los logs de Vercel**

```bash
SMOKE_TESTER_PHONE=<numero_propio_allowlisteado> npx tsx scripts/smoke-crisis-capa0.ts
```
Verificar en los logs de runtime de Vercel:
- `[CAPA0][CRISIS] manejada` aparece **DOS veces** (crisis fresca + crisis sobre conversación ya escalada) — confirma que la Capa 0 corre incluso sobre conversaciones escaladas (el fix del incidente).
- Si se probó con `auto_message_approved=true`: `[WhatsApp]` sin error 190 → contención enviada al número del tester.
- La query final imprime `alertas crisis: 2` (una por cada mensaje de crisis).

Expected: 2 detecciones de crisis, 2 alertas `crisis_detected`, contención enviada (si aprobado), sin caer en "Conversación escalada, no responder" para los mensajes de crisis.

- [ ] **Step 4: Limpiar data de prueba**

```sql
-- Reemplazar {TESTER} por el número usado (con +57)
WITH c AS (SELECT id FROM conversations WHERE clinic_id='dac775fe-6ebd-47e3-89b4-eeb1a821facb' AND whatsapp_phone IN ('+{TESTER}'))
DELETE FROM staff_notifications WHERE conversation_id IN (SELECT id FROM c);
DELETE FROM conversations WHERE clinic_id='dac775fe-6ebd-47e3-89b4-eeb1a821facb' AND whatsapp_phone = '+{TESTER}';
DELETE FROM patients WHERE clinic_id='dac775fe-6ebd-47e3-89b4-eeb1a821facb' AND phone = '+{TESTER}';
DELETE FROM audit_log WHERE clinic_id='dac775fe-6ebd-47e3-89b4-eeb1a821facb' AND action='crisis_detected' AND created_at > now() - interval '1 hour';
```
Verificar 0 filas residuales del número de prueba.

- [ ] **Step 5: Borrar el script de smoke y commit final**

```bash
git rm scripts/smoke-crisis-capa0.ts
git commit -m "chore(seguridad): remover smoke temporal de Capa 0 tras validación"
```

---

## Self-Review

**1. Spec coverage:**
- §4 Capa 0 antes de regla 15 y consentimiento → Task 5 Step 2 (inserción tras paso 14, antes de 15/16). ✓
- §5.1 detectores puros + §6 listas/falsos negativos/positivos → Task 1 (código + tests exhaustivos de idioms). ✓
- §5.2 config Zod + buildContainmentMessage → Task 2. ✓
- §5.3 migración crisis_detected + refreshed_at → Task 3. ✓
- §5.4 notifyCrisis + refreshEscalationNotifications → Task 4. ✓
- §5.6 campana 🆘 rojo + no-limpiable + orden → Task 6. ✓
- §7 fix zona muerta → Task 5 Step 3 (refresh en regla 15). ✓
- §8 gate dos niveles (Opción B) → Global Constraints + Task 2 defaults + Task 5 handleCrisis. ✓
- §9 smoke seguro + regresión del incidente → Task 7. ✓
- §5.7 reforzar guía LLM (red secundaria): **NO incluido como task en el MVP.** **PRIORIDAD ALTA post-MVP (no "algún día"):** el regex solo detecta lo que está en la lista curada; la guía del LLM es la red para lo que NO previmos (jerga regional, formas indirectas nuevas). El MVP cierra el incidente con el regex determinista; reforzar el prompt es el siguiente paso inmediato, no diferible indefinidamente.

**2. Placeholder scan:** sin TBD/TODO. Los `{TESTER}` en el SQL de limpieza (Task 7 Step 4) son sustitución explícita del número real, no placeholders de diseño.

**3. Type consistency:** `CrisisConfig` (Task 2) usado igual en Tasks 5. `notifyCrisis`/`refreshEscalationNotifications` firmas idénticas entre Task 4 (definición) y Task 5 (uso). `crisis_detected` consistente entre Tasks 3/4/6. `detectCrisis`/`detectHumanRequest` firmas idénticas Task 1 ↔ Task 5.

**Gap conocido (PRIORIDAD ALTA post-MVP):** §5.7 (reforzar prompt LLM como red secundaria) queda fuera del MVP pero es el siguiente paso inmediato — el regex solo cubre lo previsto; el LLM es la red para lo no previsto.
