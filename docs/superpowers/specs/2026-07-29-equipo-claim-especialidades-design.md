# División del trabajo del equipo: Claim + Especialidades — Design Spec

> **Estado:** DISEÑO aprobado (2026-07-29). Listo para `writing-plans`. NO construido.
> **Supersede** a `2026-07-29-claim-conversaciones-design.md` (aquel cubría solo el núcleo de A; este lo extiende con toggle/modo/vencimiento configurables + audit del override, y agrega B).
> **Depende de:** atribución de mensajes (`messages.sender_name`, ya construido) — el override del modo duro es "la otra mitad" de esa atribución.

---

## Principio rector

Un mismo paquete, dos ejes **ortogonales** que se complementan:

- **B — Especialidad DIRIGE:** a quién le aparece destacada una conversación.
- **A — Claim EVITA EL CHOQUE:** quién la está atendiendo ahora (para que no le lleguen dos respuestas a la paciente).

Una conversación puede estar **destacada para gineco (B) y tomada por María (A)** a la vez — ejes distintos. Ninguno reemplaza al otro.

## Invariantes (no negociables — la feature NO puede empeorar nada por omisión)

1. **Cero especialidades asignadas = ve TODO destacado.** El estado inicial (nadie configuró nada) se comporta **igual que hoy**: todas ven todo. La feature solo puede agregar foco, nunca quitar visibilidad. Una coordinadora sin especialidad es la generalista/supervisora que cubre todo.
2. **B nunca esconde — solo destaca/ordena.** Toda conversación sigue visible para todo el equipo, siempre. La especialidad sube y resalta; jamás filtra hacia afuera.
3. **Unión, nunca intersección, en multi-especialidad.** Una conversación que toca dos especialidades se destaca para quien cubra **cualquiera** de las dos. Nunca se exige cubrir todas.
4. **El modo duro SIEMPRE tiene salida.** "Tomar de todos modos" (con confirmación) + vencimiento automático. Un chat bloqueado sin escape es la zona muerta que ya nos mordió tres veces — prohibido.
5. **Envejecimiento → red del equipo.** Una conversación sin tomar y sin atender más de X min (configurable) se resalta para el equipo **entero**, sin importar especialidad. El día que falta quien cubre una especialidad, la paciente no queda invisible.
6. **El override del modo duro queda en `audit_log`.** Quién le sacó la conversación a quién. Complementa `sender_name`: si alguien entra seguido a conversaciones ajenas, tiene que poder verse.

---

## A) Claim configurable por clínica

### Schema
```sql
ALTER TABLE conversations
  ADD COLUMN claimed_by UUID REFERENCES clinic_users(id),
  ADD COLUMN claimed_by_name TEXT,           -- denormalizado para display sin join
  ADD COLUMN claimed_at TIMESTAMPTZ;
```
Config por clínica en `clinics.feature_config.claim` (JSONB, con defaults al leer si falta):
```jsonc
{ "enabled": true, "mode": "soft", "expiry_minutes": 10 }
// enabled default true · mode 'soft'|'hard' default 'soft' · expiry_minutes default 10
```

### Lógica
- **Auto-claim al abrir** una conversación escalada → server action `claimConversation(id)`:
  - LIBRE (`claimed_by` NULL) o **VENCIDA** (`claimed_at + expiry_minutes < now`) → setea `claimed_by=yo`, `claimed_by_name=mi nombre`, `claimed_at=now`.
  - Tomada por OTRO y vigente → NO la toma; devuelve quién la tiene (para el banner).
  - Idempotente (re-tomar la propia refresca `claimed_at`).
- **Vencimiento computado AL LEER** (`claimed_at + expiry_minutes < now → libre`). Sin cron.
- **Botón "Liberar"** → `releaseConversation(id)` (setea NULL). Solo el dueño o un override.
- **Propagación:** el realtime existente (`conversations-panel.tsx:62`, canal `conv-list-realtime`, `postgres_changes` UPDATE sobre `conversations`) ya refresca la lista y el chat en vivo. Cero plumbing nuevo.

### Modos
- **Blando (default):** banner "🙋 Tomada por X" en lista y header del chat. El `<textarea>` de respuesta (`conversation-chat.tsx:426`) **sigue habilitado** para todas.
- **Duro:** para las demás, el `<textarea>` + botón de envío (`:438`) quedan **deshabilitados**, con banner "🙋 X está atendiendo — hace N min" y el botón de escape:
  - **"Tomar de todos modos"** → confirmación ("María la tiene tomada, ¿entrar igual?") → `overrideClaim(id)`: transfiere el claim a mí, **registra en `audit_log`** (invariante 6), y habilita mi campo de respuesta.
  - Segundo escape: el **vencimiento** automático (tras `expiry_minutes` queda libre para cualquiera).
- **Toggle OFF** → no hay claim en absoluto (comportamiento actual, sin banners ni locks).

### Audit del override (invariante 6)
```
audit_log:
  action     = 'conversation_claim_override'
  actor_type = 'staff'
  actor_id   = <quién tomó de todos modos>
  target_type= 'conversation'
  target_id  = <conversation_id>
  details    = { from_user_id, from_user_name, minutes_held }
```
No se resume: cada override es una línea. Es la contraparte de `sender_name` — visibilidad de quién interviene conversaciones ajenas.

### Display
- **Lista:** badge "🙋 Tomada por [nombre]" en las tomadas vigentes.
- **Header del chat:** "🙋 [nombre] está atendiendo (hace N min)" si es de otra; "La estás atendiendo vos" si es propia.

---

## B) Especialidades por coordinadora

### Schema
```sql
ALTER TABLE clinic_users ADD COLUMN specialties TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE invitations  ADD COLUMN specialties TEXT[] NOT NULL DEFAULT '{}';
```
La config de envejecimiento vive junto a la de claim, en `clinics.feature_config.claim` (mismo bloque de coordinación):
```jsonc
{ "enabled": true, "mode": "soft", "expiry_minutes": 10, "unattended_highlight_minutes": 15 }
// unattended_highlight_minutes default 15 — CONFIGURABLE (es el salvavidas, invariante 5; no se clava en código)
```
(No hay columna de especialidad en `conversations` — ver "Derivación".)

### Asignación
- La **coordinadora** elige especialidades **al invitar** (multi-select de las `doctors.specialty` distintas de la clínica; hoy en Algia: Ginecología, Fisioterapia, Colposcopia, Psicología) y las **edita** en miembros existentes. Una persona puede cubrir varias. **Vacío = cubre todo** (invariante 1).
- El flujo `accept-invite` **copia** `invitations.specialties` → `clinic_users.specialties` al aceptar.
- Gate de permiso: la asignación de especialidades usa el mismo gate que invitar/gestionar usuarios (coordinadora+admin). *(Nota deuda: `invitations.role_id` no tiene FK — ver CLAUDE.md. Agregar `specialties[]` es aditivo, no la agrava.)*

### Derivación de la especialidad de una conversación
Matcher determinista **hermano del de Capa 0** (`src/lib/safety/specialty-matcher.ts`): reusa `normalizeForSafety`, keywords por especialidad, sin depender del LLM. Grupos derivados de los nombres reales de servicios de Algia:
- **Ginecología:** ginecolog, colposcopia, vulvoscopia, ecografia, citologia, histero(s)?copia, biopsia, diu, dispositivo intrauterino, mapeo, embarazo, prenatal, control posquirurgico…
- **Fisioterapia:** fisioterapia, piso pelvico, terapia.

Corre sobre los últimos mensajes de la conversación y devuelve un **Set de especialidades** (0, 1 o varias).
- **Antes de mencionar servicio** ("quiero una cita") → Set vacío → **pool general** (invariante 2), visible para todas, destacada para nadie.
- **Multi-especialidad** → Set con varias → destacada por **unión** (invariante 3).

### Estrategia: DERIVAR-AL-RENDER (decisión 2026-07-29)
No se persiste `conversations.specialty`. La lista corre el matcher sobre los últimos ~M mensajes de cada conversación al armar la vista (igual que la tarjeta de revisión deriva `ruledService` en vivo). Cero columna nueva, cero cambio en el webhook; el realtime que ya refresca la lista alcanza.

**Costo (lo que pediste):** por carga de lista = **N conversaciones × M mensajes × K regexes**.
- Cómputo: K ≈ 2-4 grupos (1 regex c/u), M ≈ 10-15 → ~45 tests por conversación, sub-microsegundo c/u. Con N=20 escaladas → ~900 tests, **<1 ms**. Despreciable.
- El costo real es el **fetch de N×M filas de `messages`** por carga (una query con lateral/window de los últimos M por conversación). Con Algia (N puñado, M~15 → ~300 filas) es trivial.
- **Umbral para conviene persistir:** cuando N (conversaciones escaladas simultáneas) pasa a rutinariamente **~100+**, o el fetch/re-derivación por realtime se vuelve notorio, **o** se quiere **ordenar/filtrar por especialidad en SQL** (no post-fetch). Ahí: columna `conversations.specialty TEXT[]` seteada por el webhook (determinista, estilo Capa 0), indexada. Para una clínica chica no pasa nunca; se re-evalúa al escalar multi-tenant.

### Destacado (prioridad blanda)
En `conversations-panel.tsx`, por cada conversación:
- Set de especialidad ∩ mis `specialties` ≠ ∅ (o mis specialties vacío = generalista) → **resaltada y ordenada arriba** para mí.
- Siempre visible para todas (invariante 2).
- **Envejecimiento:** sin tomar (A) y sin atender hace > `unattended_highlight_minutes` (por `escalated_at`/`last_message_at`, computado al leer, sin cron) → resaltada **para el equipo entero** con "⚠ sin atender hace N min", sin importar especialidad (invariante 5).

---

## Interacción A ↔ B (confirmada)

Ortogonales. B decide **dónde aparece destacada**; A decide **quién la atiende**. Ejemplo: una consulta de colposcopia (B→gineco) sin tomar hace 20 min (envejecimiento→resalta a todo el equipo) que Ana toma (A→"Tomada por Ana"). Los tres estados coexisten sin conflicto. El envejecimiento de B es independiente del claim de A.

---

## Dónde vive la config (decisión 2026-07-29)

Extender el panel de usuarios (`/dashboard/configuracion/usuarios`) y renombrarlo **"Equipo"**, con dos bloques:
- **Coordinación** (config de clínica): toggle de claim, modo blando/duro, `expiry_minutes`, `unattended_highlight_minutes`.
- **Miembros:** lista con especialidades editables por usuario + invitar (con especialidades).

---

## Alcance / NO-alcance

**En alcance:**
- Schema claim (`conversations` +3 cols) + config `feature_config.claim`.
- `claimConversation` / `releaseConversation` / `overrideClaim` + auto-claim al abrir + vencimiento al leer.
- Modo blando/duro + escape "tomar de todos modos" + audit del override.
- `clinic_users.specialties` + `invitations.specialties` + copia en accept-invite.
- `specialty-matcher.ts` (determinista, hermano de Capa 0) + derivar-al-render.
- Destacado por especialidad (unión) + envejecimiento configurable al equipo.
- UI "Equipo": bloque Coordinación + Miembros (multi-select de especialidades) + banners de claim en lista y chat.

**Fuera de alcance:**
- Persistir `conversations.specialty` (se agrega si N supera ~100 o se necesita sort/filter SQL).
- Presencia "escribiendo…" en tiempo real (Supabase Presence) — innecesario al volumen.
- Cola de trabajo / reasignación automática / round-robin.
- Lock a nivel base de datos (el modo duro deshabilita en UI + valida en la server action; no es un lock transaccional de DB).
- Arreglar la FK faltante de `invitations.role_id` (deuda aparte).

---

## Testing (cuando se construya)

- **Claim libre/vencido/tomado:** `claimConversation` toma libre, respeta tomada-vigente ajena, re-toma la vencida, es idempotente en la propia.
- **Vencimiento al leer:** tomada hace > `expiry_minutes` se lee como libre sin cron.
- **Modo duro + escape:** el `<textarea>` se deshabilita para no-dueña; "tomar de todos modos" transfiere y habilita; el vencimiento también libera. **Nunca queda sin salida.**
- **Audit del override:** cada "tomar de todos modos" inserta `conversation_claim_override` con `from_user` + `minutes_held`.
- **Toggle OFF:** sin claim, sin banners, comportamiento idéntico a hoy.
- **Matcher de especialidad:** deriva gineco/fisio de los nombres reales; Set vacío antes de mencionar servicio; multi-especialidad → Set con varias. Sin depender del LLM.
- **Invariante 1 (cero especialidades = ve todo):** usuario sin `specialties` ve todo destacado; una clínica sin nada configurado se comporta como hoy.
- **Invariante 2 (nunca esconde):** una conversación de otra especialidad SIGUE visible en la lista.
- **Invariante 3 (unión):** conversación multi-especialidad se destaca para coverers de cualquiera de las dos.
- **Invariante 5 (envejecimiento):** sin tomar + sin atender > `unattended_highlight_minutes` → resaltada a todo el equipo, sin importar especialidad; configurable (cambiar el número cambia el umbral).
- **Realtime:** claim/liberación/override se propagan a otras pantallas por el canal existente sin plumbing nuevo.

---

## Decisiones tomadas (2026-07-29)

1. **Derivar-al-render** la especialidad (no persistir). Umbral de persistir documentado arriba (~N≥100 o sort/filter SQL).
2. **"Equipo"** extendiendo el panel de usuarios (no sección nueva aparte).
3. **`unattended_highlight_minutes` = 15 default, CONFIGURABLE** (como `expiry_minutes`). El salvavidas no se clava en código.
4. Modo default **blando**; claim default **ON**; `expiry_minutes` default **10**.
