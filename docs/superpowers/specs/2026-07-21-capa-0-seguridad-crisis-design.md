# Capa 0 de Seguridad — Detección de crisis y pedido explícito de humano

**Estado:** Spec para revisión | **Prioridad:** P0 (bloquea el lanzamiento con pacientes reales) | **Fecha:** 2026-07-21

---

## 1. Contexto y motivación

**El incidente (verificado en código + datos + logs de prod):** un usuario de prueba escribió al agente *"Me quiero suicidar, que hago"*, luego *"Escala a humano"*. El agente no respondió, no escaló, no generó ninguna alerta. Causa raíz confirmada:

- La conversación **ya estaba en `status='escalated'`** desde 80 minutos antes, por una consulta de rutina de retiro de DIU (la regla de DIU escala para confirmación humana).
- El webhook tiene una regla (`route.ts:465-478`): si la conversación ya está escalada → `return` sin correr el agente ni ninguna detección. Los logs muestran los 4 mensajes de crisis registrando `[Webhook] Conversación escalada, no responder`.
- La detección de crisis **no existe como regla dura** — los términos de suicidio no están en las keywords de escalamiento, y el manejo de crisis vive solo como guía blanda del prompt del LLM (que ni corrió).
- La notificación de la campana quedó **congelada en el motivo original** ("Tienen cita para extracción de DIU?") porque `notifyStaffOfEscalation` es idempotente. La crisis quedó disfrazada de consulta de rutina.

**La falla de fondo:** una vez escalada por cualquier motivo, la conversación entra en una **zona muerta** — nada de lo que escriba el paciente después recibe respuesta, detección ni alerta fresca.

## 2. Objetivo

Una **Capa 0 de seguridad determinista** que corre ANTES de todo el resto del pipeline del webhook, que garantiza que:

1. Un mensaje de **crisis** (suicidio / autolesión) siempre dispara: (a) un mensaje de contención con línea de ayuda, (b) una alerta de máxima prioridad visualmente inconfundible, (c) escalación inmediata — **aunque la conversación ya esté escalada y aunque el paciente no haya dado consentimiento**.
2. Un **pedido explícito de humano** siempre escala.
3. La **zona muerta** se arregla de raíz: cualquier mensaje nuevo a una conversación escalada-no-atendida refresca la alerta.

## 3. Principios de diseño (no negociables)

- **Determinista, no depende del LLM.** Regex sobre listas curadas. El LLM queda como red secundaria, nunca como el mecanismo primario.
- **Corre ANTES** del cortocircuito de "ya escalada" (regla 15) y del gate de consentimiento (paso 16).
- **Principio rector ante ambigüedad — sobre-detectar SIEMPRE.** Cuando un mensaje sea ambiguo entre crisis real y modismo/exageración (ej. *"me quiero morir"* sin más contexto), el sistema lo trata como **CRISIS** y escala. Un falso positivo cuesta que una secretaria lea un mensaje inofensivo; un falso negativo puede costar una vida. El sistema DEBE errar hacia sobre-detectar. **Los casos ambiguos van al lado de crisis, no al de modismo** — y los tests lo reflejan (§9.1). Solo se clasifica como modismo cuando hay un **calificador inequívoco** que lo desambigua (ej. *"me quiero morir de la pena"*, *"me muero por un café"*).
- **Wording y línea de ayuda en config** (editables sin deploy, aprobados por Algia). NUNCA un número o mensaje hardcodeado que llegue a un paciente sin aprobación clínica.
- **Las keywords de crisis viven en CÓDIGO**, no en config por-clínica. Son críticas de seguridad y no deben poder debilitarse por clínica. (Solo el mensaje de contención y la línea son configurables.)
- **Honestidad sobre los límites:** el regex es un **piso**, no una garantía de cobertura total. El diseño combina regex + la guía del LLM + el arreglo de la zona muerta (que garantiza que un humano vea CADA mensaje de una conversación escalada) como redes en capas.

## 4. Arquitectura — dónde corre

En `src/app/api/webhooks/whatsapp/route.ts`, **inmediatamente después de guardar el mensaje entrante y resolver clínica/paciente/conversación** (~línea 431), y **antes** de:
- Paso 15 (cortocircuito de "ya escalada")
- Paso 16 (gate de consentimiento / `handleNewPatient`)
- Paso 16.5 (keywords de escalamiento existentes)

Orden dentro de la Capa 0:

```
1. detectCrisis(texto)        → si match → FLUJO CRISIS → return
2. detectHumanRequest(texto)  → si match → FLUJO HUMANO → return
3. (cae al pipeline normal; la regla 15 ahora refresca la alerta — ver §7)
```

Precedencia: **crisis gana sobre pedido de humano** si ambos matchean.

## 5. Componentes (unidades aisladas y testeables)

### 5.1 `src/lib/safety/crisis-patterns.ts` (lógica pura)

- `normalizeForSafety(text: string): string` — lowercase, quita acentos (NFD + strip diacríticos), colapsa espacios, colapsa letras repetidas (`holaaa`→`hola`), normaliza sustituciones comunes de tipeo (`k`→`qu`/`c` donde aplique), quita puntuación excepto la necesaria. El objetivo es tolerar tildes faltantes, mayúsculas y typos frecuentes.
- `CRISIS_PATTERNS: RegExp[]` — lista curada (ver §6).
- `detectCrisis(text): { matched: boolean; pattern?: string }`.
- `HUMAN_REQUEST_PATTERNS: RegExp[]` — lista curada.
- `detectHumanRequest(text): { matched: boolean; pattern?: string }`.

Ambas funciones son puras (sin DB, sin red) → el grueso de la validación de seguridad son tests unitarios sin enviar nada.

### 5.2 `src/lib/safety/crisis-config.ts` (Zod + puro)

- Zod schema de la config de crisis (vive en `clinics.whatsapp_config.crisis`).
- `CrisisConfig`: `{ detection_enabled: boolean; auto_message_approved: boolean; containment_message: string; human_handoff_message: string }` (asumiendo la Opción B del gate de dos niveles, §8 — se ajusta si el usuario elige la Opción A).
  - `detection_enabled` (default `true`): detectar + escalar + alertar 🆘 al staff.
  - `auto_message_approved` (default `false`): enviar el mensaje automático de contención al paciente. Solo `true` cuando Algia valida el wording.
- `buildContainmentMessage(config, patientFirstName?): string` — interpola `{nombre}` opcional; devuelve el mensaje final.
- Defaults seguros (§8): el `containment_message` incluye 106 + 123 (piso verificado) como **borrador pendiente de validación clínica**, no texto final.

### 5.3 Migración `supabase/migrations/00082_crisis_detection.sql`

- Agrega `'crisis_detected'` al CHECK de `staff_notifications.type` (hoy: `appointment_*` + `conversation_escalated`).
- Agrega columna `refreshed_at TIMESTAMPTZ` (nullable) a `staff_notifications` para el re-surface de la zona muerta (§7).
- La config de crisis vive en el JSONB `whatsapp_config` → sin cambio de schema; el default se maneja en el merge de `getWhatsAppConfig`.

### 5.4 `src/lib/notifications/escalation-notify.ts` (extensión)

- `notifyCrisis({ clinicId, conversationId, patientName, patientMessage })` — **SIEMPRE inserta** una notificación `crisis_detected` (rompe idempotencia). Fan-out a todo el staff no-Doctor. `body` = el mensaje real del paciente. `metadata.crisis = true`.
- `refreshEscalationNotifications(conversationId, latestMessage)` — para la zona muerta: `UPDATE` de las alertas de escalación vivas de esa conversación → `body` = último mensaje, `refreshed_at = now()`. Re-sube en la campana.
- Se conservan `notifyStaffOfEscalation` (primera escalación) y `resolveEscalationNotifications` (al atender).

### 5.5 `src/app/api/webhooks/whatsapp/route.ts`

- Bloque Capa 0 nuevo antes del paso 15 (§4).
- Paso 15 modificado: en vez de `notifyStaffOfEscalation` idempotente → `refreshEscalationNotifications` (§7).

### 5.6 `src/components/dashboard/notification-bell.tsx`

- `TYPE_EMOJI`: agregar `crisis_detected: '🆘'`.
- **Estilo específico de crisis:** fondo/borde rojo, etiqueta **"CRISIS"**, siempre arriba. Inconfundible respecto de una escalación normal (que es ámbar/🚨).
- Extender el trato de "no-limpiable" que hoy tiene `conversation_escalated` (líneas 105/107/112) para incluir `crisis_detected` — tampoco se limpia con "Marcar todas" ni con click; solo al atender la conversación.
- Orden: `COALESCE(refreshed_at, created_at) DESC` para que las alertas refrescadas re-suban.

### 5.7 `src/agents/prompts/system-prompt.ts` (secundario, red de respaldo)

- Mantener/reforzar la guía de crisis del LLM como red secundaria para conversaciones NO escaladas que no peguen en el regex. No es el mecanismo primario. Cambio menor de texto.

## 6. Detección — listas curadas y falsos negativos/positivos

### 6.1 Crisis (directo)

Stems y frases (tras `normalizeForSafety`), tolerando tildes/typos:
- `suicid` (suicidio, suicidarme, suicida) + variante fonética `suisid`
- `matarme`, `me mato`, `me voy a matar`, `quiero matarme`
- `quitarme la vida`, `acabar con mi vida`, `terminar con mi vida`, `acabar con todo`
- `no quiero vivir`, `ya no quiero vivir`, `no quiero seguir viviendo`, `no vale la pena vivir`
- `quiero morir`, `quisiera morir`, `me quiero morir`, `mejor muerto/a`, `estaria mejor muerto`
- `hacerme dano`, `lastimarme`, `autolesi`, `cortarme las venas`

### 6.2 Crisis (indirecto — alta sensibilidad, mayor riesgo de falso positivo)

Curada y acotada; dispara la alerta (los falsos positivos solo cuestan una revisión):
- `ya no aguanto mas`, `no doy mas`, `no le veo sentido a la vida`, `no quiero seguir aca`, `desaparecer para siempre`

### 6.3 El problema de los falsos POSITIVOS (modismos del español colombiano)

Crítico: el español coloquial usa muerte/matar como hipérbole. Pero la desambiguación NO es "la palabra existe → modismo". Es **al revés** (por el principio rector, §3): una frase de intención **sin calificador es CRISIS**; solo es modismo cuando hay un **calificador inequívoco** que la desambigua.

**Regla del calificador — negative-lookahead:** los patrones de `morir` matchean como crisis (`(me )?quiero morir`, `quisiera morir`, `me quiero morir`) EXCEPTO cuando van seguidos de un calificador de modismo:
- `de (la )?(pena|verguenza|risa|susto|aburrimiento|ganas|hambre|sueno|frio|amor)`
- `por ` + deseo (`me muero por un café`, `me muero por verte`)

Ejemplos de la frontera:
- `me quiero morir` (solo) → **CRISIS** (ambiguo → crisis)
- `me quiero morir de la pena` / `de la vergüenza` → modismo (calificador) → **NO dispara**
- `me muero por un café` / `me muero por verte` → deseo → **NO dispara**

Modismos que NO deben disparar (tests negativos §9.1), pasados por el usuario + base:
- `me quiero morir de la pena/vergüenza`, `qué pena tan berraca`
- `me muero por` (un café, verte, etc. — deseo)
- `matar el tiempo`, `me está matando el trabajo/la espalda`, `me mata la curiosidad`
- `morirse de risa / del susto / del aburrimiento / de las ganas`
- `me muero de risa / hambre / sueño / ganas / frío`
- `me matas de risa`, `esto me mata`, `me duele la cabeza`, `mortal` (adjetivo), `morir de amor`

Para `matar`, los patrones usan la forma reflexiva de intención (`matarme`, `me mato`, `me voy a matar`) — nunca `me mata` / `me matas` (que son hipérbole). Los tests negativos cubren explícitamente todos estos casos.

### 6.4 Pedido explícito de humano

- `humano`, `un humano`, `ser humano`, `agente humano`
- `persona`, `persona real`, `una persona`
- `asesor`, `secretaria`, `alguien del consultorio`, `alguien real`
- `hablar con alguien`, `hablar con una persona`
- `escalar`, `escala a humano/persona`, `pasame con`, `necesito una persona`

Nota: hoy las keywords de Algia (`urgencia, dolor, emergencia, hablar con alguien, médico, sangrado`) **no cubren** "humano"/"escalar" — de ahí que "Escala a humano" no escalara ni siquiera fuera de la zona muerta. Esta lista lo cierra.

### 6.5 Límite honesto

El regex no captura toda expresión posible de crisis (jerga regional, formas muy indirectas, ironía). Mitigaciones en capas: (a) normalización agresiva de typos/tildes, (b) lista indirecta curada, (c) la guía del LLM sigue activa para conversaciones no escaladas, (d) **el arreglo de la zona muerta garantiza que un humano vea cada mensaje** de una conversación escalada — la persona es la red final. No afirmamos cobertura total del regex.

## 7. Arreglo de la zona muerta

Hoy `notifyStaffOfEscalation` es idempotente → 10 mensajes a una conversación escalada = 1 alerta congelada. Cambio:

- **Crisis** siempre rompe idempotencia (corre en Capa 0, antes del paso 15).
- **Cualquier otro mensaje** a una conversación escalada-no-atendida → paso 15 llama `refreshEscalationNotifications`: actualiza `body` al último mensaje + `refreshed_at` → la alerta refleja lo último que dijo el paciente y re-sube en la campana. Una sola alerta viva por conversación (no multiplica filas), pero siempre fresca.

## 8. Mensaje de contención

Requisitos: empático, con la línea de ayuda, **sin consejo médico ni diagnóstico**, deja claro que **una persona real va a contactar**, género-neutro. NO minimiza ("todo va a estar bien"). Editable en config, aprobado por Algia + criterio clínico antes de llegar a un paciente real.

**⚠️ BORRADOR — PENDIENTE DE VALIDACIÓN CLÍNICA. El texto exacto que se le dice a una persona en crisis lo valida criterio clínico (Lady + un médico de Algia), NO nosotros.** Este default es solo un punto de partida técnico para que Algia lo revise; no es texto final.

**Default (borrador; Algia valida y aprueba):**
> "Lamento mucho que estés pasando por esto, y me importa. No estás solo/a. Por favor comunícate ahora con la Línea 106 (salud mental, gratuita, 24/7) o llama al 123 si estás en peligro inmediato. Una persona del consultorio va a contactarte lo antes posible. 🙏"

**Gate de activación — DECISIÓN ABIERTA (confirmar en la revisión del plan):** el wording borrador **NO puede enviarse a un paciente real** sin validación clínica. Hay dos formas de gatearlo, con implicancias de seguridad distintas:

- **Opción A — gate único (todo apagado):** un flag `crisis.enabled=false` para Algia apaga TODA la capa hasta la aprobación. Simple, pero durante la brecha las crisis **tampoco se detectan ni alertan al staff** → una persona en crisis queda en silencio Y sin que nadie del equipo se entere.
- **Opción B — gate de dos niveles (RECOMENDADA):** la **detección + escalación + alerta 🆘 al staff** están SIEMPRE activas (son puro upside: solo avisan a un humano, no hay texto de riesgo hacia el paciente). Lo único gateado es el **mensaje automático de contención al paciente** (`crisis.auto_message_approved=false` hasta que Algia valide el wording). Con esto, apenas alguien escribe una crisis, el staff recibe la alerta roja inmediata aunque el auto-mensaje todavía no esté aprobado — se evita el silencio total.

**Recomiendo la Opción B**: maximiza seguridad (nunca dejamos de detectar/alertar) y honra "no enviar wording no validado". El usuario decide en la revisión del plan. En ambas: código construido y probado (unitarios + smoke a número propio) antes de tocar producción; el default 106 + 123 es piso solo para tests.

**Handoff de humano (default):**
> "Con gusto te paso con una persona del consultorio. Ya te contactan. 🙏"

## 9. Testing

### 9.1 Unitarios (grueso de la validación de seguridad — SIN enviar nada)

`scripts/test-crisis-detection.ts`:
- **Positivos crisis:** decenas de frases — directas, indirectas, con typos, sin tildes, mayúsculas mezcladas, el mensaje real del incidente ("Me quiero suicidar, que hago"). Cada una DEBE detectar.
- **Casos AMBIGUOS → lado CRISIS (positivos):** por el principio rector (§3), las frases de intención sin calificador van al set de crisis y DEBEN disparar: `me quiero morir`, `quiero morir`, `ya no quiero estar aca`. Un test que ponga estos como negativos es un bug del test.
- **Negativos crisis (falsos positivos):** los modismos de §6.3 CON calificador inequívoco. NINGUNO debe disparar: `me quiero morir de la pena`, `me quiero morir de la vergüenza`, `qué pena tan berraca`, `me muero por un café`, `me muero por verte`, `matar el tiempo`, `me está matando el trabajo`, `me está matando la espalda`, `me mata la curiosidad`, `morirse de risa`, `morirse del susto`, `morirse del aburrimiento`, `morirse de las ganas`, `me muero de risa`, `me muero de hambre`, `me muero de sueño`, `me muero de frío`, `me matas de risa`, `esto me mata`, `me duele la cabeza`, `mortal`, `morir de amor`.
- **Positivos/negativos de pedido de humano:** "Escala a humano", "necesito una persona", "humano*" (el del incidente) vs frases que contienen "persona" sin pedir humano.

`scripts/test-crisis-config.ts`:
- Snapshot de `buildContainmentMessage` (config → string exacto), interpolación de `{nombre}`, defaults.

### 9.2 Smoke E2E seguro — SIN mandar crisis a nadie real

- Forjar el webhook (firmado, como el probe de escalación) desde un **número de prueba controlado (el celular propio del tester, allowlisteado en el Test Number)**. El "mensaje de crisis" de prueba solo puede llegar al teléfono del tester, **nunca a un paciente real**.
- Verificar en LOGS: (a) crisis detectada, (b) **el mensaje de contención se ENVIÓ con éxito** (confirma el punto 4 del usuario — el envío no puede fallar; con el token permanente ya resuelto debe salir), (c) alerta `crisis_detected` creada con `body` = el mensaje real.
- **Regresión del incidente exacto:** escalar una conversación (flujo DIU) y LUEGO mandar el mensaje de crisis → verificar que la crisis se detecta **a pesar de estar ya escalada**, el mensaje de contención sale, y la alerta 🆘 se crea (no disfrazada de la escalación previa).
- **Zona muerta:** mensaje benigno a una conversación escalada → verificar que la alerta se refresca (body + re-surface), no que se ignora.
- Limpiar toda la data de prueba después (paciente falso, conversación, mensajes, notificaciones, audit).

### 9.3 Qué NO hacemos

No enviamos mensajes de crisis reales a pacientes reales en ningún test. Toda validación es unitaria (sin red) o E2E contra un número propio controlado.

## 10. Rollout y gates de seguridad

- Esta capa **debe estar construida y verificada ANTES** de exponer el agente a pacientes reales (antes del lanzamiento con el número productivo).
- **Gate clínico duro (patient-facing):** el **mensaje automático de contención** NO llega a un paciente real hasta que Lady + un médico de Algia aprueben el wording final y confirmen la línea de ayuda local (Pereira/Risaralda). Se controla con `auto_message_approved=false` (Opción B) o `enabled=false` (Opción A) — ver §8. El usuario lo lleva a Lady.
- Con la Opción B, la **detección + alerta 🆘 al staff arranca activa** desde el deploy (no espera la validación clínica, porque no hay texto de riesgo hacia el paciente).
- El mensaje de contención, cuando se active, debe confirmarse que **efectivamente se envía** (smoke §9.2) — es el único mensaje que no puede fallar.

## 11. Fuera de alcance (YAGNI)

- Clasificación de crisis por ML/LLM (el piso regex + red humana es el MVP).
- UI de settings para editar el mensaje de contención (editar por config/SQL alcanza inicialmente; UI es futuro si se pide).
- Multi-idioma (solo español).
- Detección de crisis en imágenes/audio (solo texto; media hoy está detrás de feature flag off).

## 12. Ítems abiertos que requieren input de Algia/clínico (no bloquean el código)

- Wording final de contención + línea de ayuda local de Pereira/Risaralda (el usuario confirma con Lady/un médico). Default 106+123 es el piso seguro mientras tanto.

## 13. Archivos afectados (resumen)

| Archivo | Cambio |
|---|---|
| `src/lib/safety/crisis-patterns.ts` | NUEVO — detectCrisis / detectHumanRequest / normalize (puro) |
| `src/lib/safety/crisis-config.ts` | NUEVO — Zod + buildContainmentMessage (puro) |
| `supabase/migrations/00082_crisis_detection.sql` | NUEVO — CHECK 'crisis_detected' + columna refreshed_at |
| `src/lib/notifications/escalation-notify.ts` | notifyCrisis + refreshEscalationNotifications |
| `src/app/api/webhooks/whatsapp/route.ts` | Capa 0 antes del paso 15/16; paso 15 refresca |
| `src/components/dashboard/notification-bell.tsx` | 🆘 CRISIS rojo, no-limpiable, orden por refreshed_at |
| `src/types/database.ts` | WhatsAppConfig.crisis |
| `src/app/api/webhooks/whatsapp/route.ts` (getWhatsAppConfig) | default de crisis en el merge |
| `src/agents/prompts/system-prompt.ts` | reforzar guía de crisis del LLM (red secundaria) |
| `scripts/test-crisis-detection.ts` | NUEVO — unitarios (positivos + falsos positivos idioms) |
| `scripts/test-crisis-config.ts` | NUEVO — snapshot del mensaje |
