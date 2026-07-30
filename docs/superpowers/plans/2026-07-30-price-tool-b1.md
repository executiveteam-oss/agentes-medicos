# Tool de precio con la regla adentro (B1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que el agente NO pueda revelar un precio que no debe — estructural, no por prompt. Se sacan TODOS los precios del catálogo del prompt y el único camino a un precio es un tool cuyo executor aplica la regla en código: sin modo → pregunta; particular → precio exacto (Ley 1480); EPS/prepagada → mensaje de copago, NUNCA la tarifa.

**Architecture:** Lógica pura testeable (`price-tool-logic.ts`: normaliza el modo + decide la respuesta) + un tool `get_consultation_price` cableado en el schema de Anthropic y en el executor (lee el CT por id, corre la lógica pura, devuelve un mensaje listo para relatar). El catálogo del system prompt deja de inyectar precios; la sección de reglas de precio del prompt manda usar el tool.

**Tech Stack:** TypeScript estricto, Claude tool use (Anthropic SDK), Supabase (lectura de `consultation_types`), `tsx` para tests puros (patrón `scripts/test-*.ts`).

## Global Constraints

- **El fix A ya sacó las tarifas de CONVENIO del catálogo** (`system-prompt.ts:164`, `priceStr` solo si `!eps_name`). B1 saca TAMBIÉN los particulares → el catálogo queda SIN ningún precio.
- **NO sacar el nombre del convenio** (`[Coomeva]`) del catálogo — decisión explícita del usuario: el nombre no es el riesgo, y el agente debe poder responder "¿atienden COOMEVA?". Solo se van los PRECIOS.
- **Regla de oro (en código, Haiku-proof):** solo el modo que normaliza EXACTO a `particular` habilita un precio. Nunca caer a particular por defecto. Ante duda → NO dar precio (preguntar cómo paga).
- **Segunda red:** aun con modo=particular, si el CT resuelto tiene `eps_name != null`, el tool NO devuelve su tarifa.
- **EPS/prepagada NUNCA reciben una tarifa** — reciben el mensaje de copago.
- **Textos EXACTOS (tuteo colombiano), verbatim:**
  - particular: `El valor particular de {servicio} es {precio}.`
  - eps: `Con tu EPS, lo que pagas es un copago que depende de tu plan; el equipo del consultorio te lo confirma al agendar tu cita.`
  - prepagada: `Con tu medicina prepagada, lo que pagas depende de tu plan y de la autorización; el equipo del consultorio te lo confirma al agendar tu cita.`
  - unknown: `Para decirte el valor necesito saber cómo vas a pagar: ¿particular, EPS o medicina prepagada?`
  - convenio-CT-con-modo-particular / sin precio: `Ese valor lo confirma el equipo del consultorio; ¿quieres que te agende?`
- **Caching:** el catálogo sin precios sigue estable → se preserva el prompt caching. No mover el `PROMPT_CACHE_SPLIT_ANCHOR`.
- Filtrar SIEMPRE por `clinic_id` en la lectura del CT. TS estricto, sin `any`. Commits en español.

---

### Task 1: Lógica pura — normalización de modo + decisión de precio

**Files:**
- Create: `src/lib/rules/price-tool-logic.ts`
- Test: `scripts/test-price-tool-logic.ts`

**Interfaces:**
- Produces:
  - `type PaymentMode = 'particular' | 'eps' | 'prepagada' | 'unknown'`
  - `normalizePaymentMode(raw: string | null | undefined): PaymentMode`
  - `interface PriceCtInput { name: string; price: number | null; eps_name: string | null }`
  - `type PriceDecision = { action: 'ask_mode' | 'convenio_copago_eps' | 'convenio_copago_prepagada' | 'no_particular_price' | 'quote_particular'; message: string; price?: number }`
  - `decidePriceResponse(ct: PriceCtInput, mode: PaymentMode): PriceDecision`
  - `formatCOP` se reutiliza de `@/lib/utils` (ya existe; el mensaje particular usa el precio formateado).

- [ ] **Step 1: Escribir los tests (fallan)**

```ts
// scripts/test-price-tool-logic.ts
import { normalizePaymentMode, decidePriceResponse } from '../src/lib/rules/price-tool-logic'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

// --- normalizePaymentMode ---
assert('exacto "particular"', normalizePaymentMode('particular') === 'particular')
assert('"PARTICULAR" → particular', normalizePaymentMode('PARTICULAR') === 'particular')
assert('"particular " (espacio) → particular', normalizePaymentMode('particular ') === 'particular')
assert('"  Particular  " → particular', normalizePaymentMode('  Particular  ') === 'particular')
assert('"eps" → eps', normalizePaymentMode('eps') === 'eps')
assert('"EPS Sura" → eps', normalizePaymentMode('EPS Sura') === 'eps')
assert('"prepagada" → prepagada', normalizePaymentMode('prepagada') === 'prepagada')
assert('"prepagada MEDPLUS" → prepagada (seguro)', normalizePaymentMode('prepagada MEDPLUS') === 'prepagada')
assert('"prepagadá" con tilde → prepagada', normalizePaymentMode('prepagadá') === 'prepagada')
assert('vacío → unknown', normalizePaymentMode('') === 'unknown')
assert('null → unknown', normalizePaymentMode(null) === 'unknown')
assert('basura "asdf" → unknown', normalizePaymentMode('asdf') === 'unknown')
assert('aseguradora suelta "medplus" → unknown (no asume)', normalizePaymentMode('medplus') === 'unknown')

// --- decidePriceResponse ---
const particularCt = { name: 'Ecografía de Mapeo', price: 264720, eps_name: null }
const convenioCt = { name: 'Colposcopia', price: 250000, eps_name: 'COOMEVA MEDICINA PREPAGADA SA' }
const particularSinPrecio = { name: 'Consulta X', price: null, eps_name: null }

// modo unknown → siempre pregunta, nunca precio
assert('unknown → ask_mode', decidePriceResponse(particularCt, 'unknown').action === 'ask_mode')
// modo eps/prepagada → copago, NUNCA tarifa (ni siquiera si el CT tiene price)
const eps = decidePriceResponse(convenioCt, 'eps')
assert('eps → copago_eps', eps.action === 'convenio_copago_eps')
assert('eps NO incluye la tarifa 250.000', !eps.message.includes('250') && eps.price === undefined)
const prep = decidePriceResponse(particularCt, 'prepagada')
assert('prepagada → copago_prepagada', prep.action === 'convenio_copago_prepagada')
assert('prepagada NO incluye precio', prep.price === undefined && !/\d{3}/.test(prep.message.replace('plan','')))
// modo particular + CT particular → precio exacto
const q = decidePriceResponse(particularCt, 'particular')
assert('particular + CT particular → quote_particular', q.action === 'quote_particular' && q.price === 264720)
assert('quote incluye el precio formateado', q.message.includes('264.720'))
// SEGUNDA RED: particular pero CT es de convenio → NO da tarifa
const guard = decidePriceResponse(convenioCt, 'particular')
assert('particular + CT convenio → no_particular_price (defensa)', guard.action === 'no_particular_price')
assert('esa defensa NO filtra la tarifa 250.000', !guard.message.includes('250') && guard.price === undefined)
// particular sin precio configurado → no_particular_price
assert('particular + CT sin precio → no_particular_price', decidePriceResponse(particularSinPrecio, 'particular').action === 'no_particular_price')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npx tsx scripts/test-price-tool-logic.ts`
Expected: FAIL — "Cannot find module '../src/lib/rules/price-tool-logic'".

- [ ] **Step 3: Implementar**

```ts
// src/lib/rules/price-tool-logic.ts
// Lógica pura del tool de precio (B1). La REGLA vive acá, no en el prompt.
// Regla de oro: solo el modo EXACTO 'particular' habilita un precio. Nunca se
// cae a particular por defecto. EPS/prepagada NUNCA reciben tarifa.
import { formatCOP } from '@/lib/utils'

export type PaymentMode = 'particular' | 'eps' | 'prepagada' | 'unknown'

export function normalizePaymentMode(raw: string | null | undefined): PaymentMode {
  if (!raw) return 'unknown'
  const n = raw
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin tildes
    .replace(/\s+/g, ' ')
    .trim()
  if (n === 'particular') return 'particular'          // SOLO exacto habilita precio
  if (n.includes('eps')) return 'eps'
  if (n.includes('prepagada')) return 'prepagada'
  return 'unknown'                                      // default seguro: preguntar
}

export interface PriceCtInput { name: string; price: number | null; eps_name: string | null }

export type PriceDecision =
  | { action: 'ask_mode'; message: string }
  | { action: 'convenio_copago_eps'; message: string }
  | { action: 'convenio_copago_prepagada'; message: string }
  | { action: 'no_particular_price'; message: string }
  | { action: 'quote_particular'; message: string; price: number }

const MSG_ASK = 'Para decirte el valor necesito saber cómo vas a pagar: ¿particular, EPS o medicina prepagada?'
const MSG_EPS = 'Con tu EPS, lo que pagas es un copago que depende de tu plan; el equipo del consultorio te lo confirma al agendar tu cita.'
const MSG_PREPAGADA = 'Con tu medicina prepagada, lo que pagas depende de tu plan y de la autorización; el equipo del consultorio te lo confirma al agendar tu cita.'
const MSG_NO_PARTICULAR = 'Ese valor lo confirma el equipo del consultorio; ¿quieres que te agende?'

export function decidePriceResponse(ct: PriceCtInput, mode: PaymentMode): PriceDecision {
  if (mode === 'unknown') return { action: 'ask_mode', message: MSG_ASK }
  if (mode === 'eps') return { action: 'convenio_copago_eps', message: MSG_EPS }
  if (mode === 'prepagada') return { action: 'convenio_copago_prepagada', message: MSG_PREPAGADA }
  // mode === 'particular'
  // Segunda red: si el CT es de convenio, NUNCA devolver su tarifa aunque digan particular.
  if (ct.eps_name != null) return { action: 'no_particular_price', message: MSG_NO_PARTICULAR }
  if (ct.price == null) return { action: 'no_particular_price', message: MSG_NO_PARTICULAR }
  return { action: 'quote_particular', price: ct.price, message: `El valor particular de ${ct.name} es ${formatCOP(ct.price)}.` }
}
```

- [ ] **Step 4: Correr los tests (pasan)**

Run: `npx tsx scripts/test-price-tool-logic.ts`
Expected: `Resultado: 25 ✅ / 0 ❌` (o el conteo exacto de asserts).
Nota: si el conteo difiere del literal por algún assert, ajustar el número — lo que importa es 0 ❌.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules/price-tool-logic.ts scripts/test-price-tool-logic.ts
git commit -m "feat(agente): lógica pura del tool de precio — normalización de modo + regla (B1)"
```

---

### Task 2: Cablear el tool `get_consultation_price`

**Files:**
- Modify: el schema de tools de Anthropic (buscar dónde se define el array de `tools` con `check_eps_convenio` — probablemente `src/lib/anthropic/tools.ts`; confirmarlo por grep de `check_eps_convenio`).
- Modify: `src/agents/tools/executor.ts` (agregar `case 'get_consultation_price':` en el switch, junto al de `check_eps_convenio` en la línea ~80).

**Interfaces:**
- Consumes: `normalizePaymentMode`, `decidePriceResponse`, `PriceCtInput` (Task 1); `supabaseAdmin`; el `clinicId` que el executor ya tiene en scope (ver cómo lo obtienen los otros case, ej. `check_eps_convenio`).
- Tool schema (input): `{ consultation_type_id: string (requerido), modo_pago: string (requerido) }`. Descripción del tool: "Devuelve el mensaje correcto sobre el valor de un tipo de consulta según cómo paga el paciente. USALO SIEMPRE que el paciente pregunte un precio; NUNCA digas un precio de memoria. modo_pago: 'particular', 'eps' o 'prepagada'."
- Produces (retorno del executor al LLM): `{ success: true, data: { message: string, action: string } }` — el LLM RELATA `message` al paciente tal cual.

- [ ] **Step 1: Agregar el tool al schema**

Localizar el array de tools (grep `name: 'check_eps_convenio'`). Agregar una entrada `get_consultation_price` con el input_schema `{ type:'object', properties: { consultation_type_id: {type:'string'}, modo_pago: {type:'string', description:"'particular' | 'eps' | 'prepagada'"} }, required: ['consultation_type_id','modo_pago'] }` y la descripción de arriba.

- [ ] **Step 2: Agregar el case en el executor**

```ts
// dentro del switch de executor.ts, junto a case 'check_eps_convenio':
case 'get_consultation_price': {
  const { normalizePaymentMode, decidePriceResponse } = await import('@/lib/rules/price-tool-logic')
  const ctId = input.consultation_type_id as string | undefined
  if (!ctId) return { success: true, data: { action: 'ask_mode', message: 'Para decirte el valor necesito saber cómo vas a pagar: ¿particular, EPS o medicina prepagada?' } }
  const { data: ct } = await supabaseAdmin
    .from('consultation_types')
    .select('name, price, eps_name')
    .eq('id', ctId)
    .eq('clinic_id', clinicId)          // <-- usar el clinicId en scope del executor
    .maybeSingle()
  if (!ct) return { success: true, data: { action: 'no_particular_price', message: 'Ese valor lo confirma el equipo del consultorio; ¿quieres que te agende?' } }
  const mode = normalizePaymentMode(input.modo_pago as string | undefined)
  const decision = decidePriceResponse(ct as { name: string; price: number | null; eps_name: string | null }, mode)
  return { success: true, data: { action: decision.action, message: decision.message } }
}
```
(Ajustar `clinicId` y la forma exacta del `input`/retorno al patrón real del executor — mirar `check_eps_convenio` como molde. NO usar `any`; tipar el row.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/lib/anthropic/tools.ts src/agents/tools/executor.ts
git commit -m "feat(agente): tool get_consultation_price con la regla de precio en el executor (B1)"
```

---

### Task 3: Sacar TODOS los precios del catálogo + prompt manda usar el tool

**Files:**
- Modify: `src/agents/prompts/system-prompt.ts` (catálogo `:164` + precio de clínica `:348` + sección de reglas de precio)
- Modify: `scripts/test-catalog-no-convenio-price.ts` (extender: ahora NINGÚN precio en el catálogo)

**Interfaces:**
- Consumes: nada nuevo. Task 2 provee el tool que el prompt referencia.

- [ ] **Step 1: Quitar el precio del catálogo (todos los CTs)**

En `:164`, reemplazar la línea del fix A por (sin precio para NADIE):
```ts
// B1 (2026-07-30): NINGÚN precio va al catálogo — ni particular ni convenio.
// El único camino a un precio es el tool get_consultation_price (regla en código).
const priceStr = ''
```
(Dejar el resto de la línea `:196` igual — `${priceStr}` queda vacío. NO tocar `epsStr` — el nombre del convenio se conserva a propósito.)

- [ ] **Step 2: Neutralizar el precio de clínica (`:348`)**

`- Precio consulta: ${priceText}` → reemplazar por una línea que NO exponga precio, p. ej.:
`- Precios: usa SIEMPRE la herramienta get_consultation_price (nunca digas un precio de memoria).`
Y quitar/ignorar `priceText` si queda sin uso (evitar variable sin usar; si `formatCOP`/`priceText` quedan sin referencia, limpiarlos).

- [ ] **Step 3: Reescribir la sección de reglas de precio del prompt para mandar el tool**

Ubicar la sección "REGLA CRÍTICA — PRECIOS SEGÚN MODALIDAD DE PAGO" y "REGLA — PRECIO PREGUNTADO ANTES DE IDENTIFICAR MODALIDAD" (~líneas 782-811). Reemplazar la lógica de "decidí vos qué precio decir" por: "Para dar CUALQUIER valor, llamá `get_consultation_price(consultation_type_id, modo_pago)` y relatá su `message` tal cual. NUNCA digas un precio de memoria ni lo inventes. Si no sabés el modo, el tool te va a pedir preguntarlo." Mantener el tono/formato del resto del prompt. (El tool es la fuente de verdad; el prompt solo enruta hacia él.)

- [ ] **Step 4: Extender el test de regresión del catálogo**

En `scripts/test-catalog-no-convenio-price.ts`, agregar asserts: el CT particular AHORA tampoco muestra precio (`!lineaParticular.includes('264.720')`), y el prompt NO contiene ningún `$` de tarifa en el listing de CTs. Mantener: el nombre `[COOMEVA...]` SIGUE presente (no se sacó). Renombrar el archivo mentalmente a "sin precios en catálogo" (o dejar el nombre; agregar los asserts nuevos).

- [ ] **Step 5: Correr tests + snapshots del prompt + build**

Run:
```bash
npx tsx scripts/test-catalog-no-convenio-price.ts
for t in test-rule-prompt-snapshot test-rule-auth-convenio-prompt-snapshot test-rule-patient-condition-prompt-snapshot; do npx tsx scripts/$t.ts | tail -1; done
npx tsc --noEmit && npm run build
```
Expected: el test de catálogo pasa con los asserts nuevos; los snapshots que asertaban precios se actualizan en ESTE step si fallan (quitar del snapshot el precio esperado — es el cambio intencional); tsc + build limpios.
Nota: `test-rule-age-limit-prompt-snapshot` tiene 2 ❌ PREEXISTENTES (texto de sección stale, no relacionados con precios) — NO son de este cambio; dejarlos como están salvo que el reviewer diga otra cosa.

- [ ] **Step 6: Commit**

```bash
git add src/agents/prompts/system-prompt.ts scripts/test-catalog-no-convenio-price.ts
git commit -m "feat(agente): sacar todos los precios del catálogo; el prompt manda usar get_consultation_price (B1)"
```

---

## Self-Review

**1. Spec coverage (las 4 reglas del usuario + sus 2 pedidos):**
- Regla 1 (sin modo → no precio): `decidePriceResponse(_, 'unknown') → ask_mode` (Task 1) + catálogo sin precios (Task 3) → estructural. ✅
- Regla 2 (particular → precio exacto): `quote_particular` con `ct.price` (Task 1). ✅
- Regla 3 (EPS/prepagada → nunca tarifa): `convenio_copago_*` sin `price` (Task 1). ✅
- Regla 4 (nunca tarifa junto a convenio / comparar): no hay tarifas en el contexto (Task 3) + el tool jamás las emite. ✅
- Pedido 1 (texto de cada modo): definidos verbatim en Global Constraints + Task 1. ✅
- Pedido 2 (normalización, nunca default a particular): `normalizePaymentMode` — solo exacto 'particular' habilita; todo lo demás eps/prepagada/unknown; unknown → pregunta. Segunda red en `decidePriceResponse` (convenio CT + particular → no tarifa). ✅
- Sin sacar `[Coomeva]`: `epsStr` intacto (Task 3 Step 1 explícito). ✅

**2. Placeholder scan:** los "ajustar al patrón real del executor / confirmar por grep" en Task 2 son instrucciones concretas de localización (el executor y el schema son código existente que el implementer abre), no lógica faltante. Sin TBD/TODO de lógica.

**3. Type consistency:** `PaymentMode`, `PriceCtInput`, `PriceDecision`, `normalizePaymentMode`, `decidePriceResponse` usados con las mismas firmas en Task 1→2. El retorno del executor `{success, data:{message, action}}` es el que el prompt (Task 3) instruye relatar. `formatCOP` reutilizado de `@/lib/utils` (confirmar el import path real en Task 1).
