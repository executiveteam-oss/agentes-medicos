# BUG — Hallucination de confirmación de identidad

**Fecha:** 2 de junio de 2026
**Reportado por:** Lady (clínica Algia, primer test cliente real con Omuwan)
**Severidad:** CRÍTICA — bloqueante para piloto
**Estado:** Parchado — pendiente deploy + observación

---

## 1. Reproducción exacta

```
Lady     → "BUEN DÍA"
Lady     → "para pedir una cita"
Agente   → "¡Hola Lady León! 👋 Veo que ya eres paciente nuestro.
            ¿Confirmas que eres Lady León, CC 42126898, afiliado/a a
            Coomeva? Responde Sí para continuar o No si algo cambió."
Agente   → "¡Perfecto! Como ya confirmaste tus datos, vamos directo al
            agendamiento. ¿Qué tipo de consulta necesitas?"
```

**Lady NUNCA respondió "Sí".** El agente fabricó la confirmación de identidad y avanzó.

---

## 2. Diagnóstico (Phase 1 — root cause)

Dos causas concurrentes, ambas presentes en el incidente.

### Causa A — Race condition entre webhooks paralelos

`src/app/api/webhooks/whatsapp/route.ts` **no tiene mutex ni lock por conversación**. Lady envió "BUEN DÍA" y "para pedir una cita" en rápida sucesión (segundos). Meta despacha dos webhooks independientes y Next.js los procesa en paralelo (Vercel serverless).

Flujo afectado (líneas 256–262 del webhook):

```ts
// Se carga historial ANTES de guardar el mensaje actual
const messageHistory = await getMessageHistory(conversation.id)
await saveMessage(conversation.id, 'patient', sanitizedText, message.id)
```

Si Run B (procesando "para pedir una cita") arranca antes de que Run A guarde su respuesta del agente:

- **Run A** ve historial `[]`, agrega "BUEN DÍA", llama Claude → genera pregunta de confirmación
- **Run B** ve historial `[]` (Run A no terminó), agrega "para pedir una cita", llama Claude → no ve la pregunta de Run A

Run B le pasa a Claude un contexto donde "para pedir una cita" parece ser el primer mensaje + la sección PACIENTE RECURRENTE del system prompt diciendo "Todos los datos están completos — NO pidas ningún dato, ve directo al agendamiento".

### Causa B — System prompt con instrucciones contradictorias

`buildExistingPatientSection` (versión vieja) instruía:

```
1. PRIMER mensaje: salúdalo y pide confirmación de identidad
2. Si confirma → salta recolección de datos
4. Todos los datos están completos — NO pidas ningún dato, ve directo al agendamiento
5. Solo haz la pregunta de confirmación en el PRIMER mensaje. Si ya se confirmó, no la repitas
```

Claude (temp 0.3) interpreta esto como un **pipeline lineal**: "datos completos + paciente pide cita → siguiente paso del pipeline". Genera la frase de transición ("Como ya confirmaste tus datos…") aunque la afirmación nunca ocurrió. Step 5 sin Step 1 efectivo lleva al modelo a asumir "ya se confirmó implícitamente".

### Por qué el guard existente no lo cubría

El guard `looksLikeConfirmation` solo dispara si el mensaje contiene `✅ cita (confirmada|agendada|creada)`. El bug usa frase `"como ya confirmaste tus datos"` — pasa el filtro porque no es claim de cita creada, es claim de confirmación de identidad.

---

## 3. Parches aplicados

### 3.1 Webhook guard nuevo (`src/lib/whatsapp/agent-guards.ts`)

Cuatro guards puros, testables, ejecutados en cascada justo antes de enviar la respuesta al paciente:

| Guard | Detecta | Acción si bloquea |
|---|---|---|
| `detectHallucinatedIdentity` | Frases "ya confirmaste", "como confirmaste", "datos confirmados", "gracias por confirmar", "una vez confirmada tu identidad" sin afirmación válida del paciente | Reemplaza con re-pregunta: "Antes de continuar necesito que confirmes tu identidad. ¿Eres [nombre], [CC X]? Respóndeme sí o no." |
| `detectHallucinatedCancellation` | "tu cita cancelada/anulada", "cancelé tu cita" sin `cancel_appointment` en toolsUsed | "Disculpa, tuve un problema procesando la cancelación. ¿Me confirmas qué cita quieres cancelar?" |
| `detectHallucinatedReschedule` | "tu cita reagendada/reprogramada" sin `reschedule_appointment` ni `create_appointment` | "Disculpa, tuve un problema procesando el reagendamiento. ¿Me confirmas el nuevo horario que prefieres?" |
| `detectHallucinatedAppointmentConfirmation` | `✅ cita confirmada/agendada/creada` sin `appointmentData` (guard preexistente, ahora unificado) | Igual al anterior pero para creación |

**Detección de afirmación válida (Guard 1):**
- Busca en el historial la última solicitud de confirmación del agente (`confirmas que eres / ¿confirmas? / responde sí`)
- Recopila mensajes del paciente posteriores a esa solicitud + el mensaje actual
- Si alguno matchea `^(sí|si|correcto|exacto|dale|claro|ok|listo|confirmo|así es|esa soy|soy yo|...)\s*[!.,]?$` o `^(sí|si)\b[\s,.!]` → válido
- "para pedir una cita", "necesito agendar", "quiero una cita" **NO** matchean → bloquea

Cada bloqueo genera entrada en `audit_log` con `action: {reason}_blocked` y el texto original truncado.

### 3.2 System prompt endurecido (`src/agents/prompts/system-prompt.ts`)

**Tres cambios:**

1. **Regla inquebrantable #12** (línea ~272) junto a las demás reglas globales:
   > NUNCA generes frases como "ya confirmaste", "como confirmaste tus datos", "gracias por confirmar" SIN que el ÚLTIMO mensaje del paciente sea una afirmación explícita. Mensajes como "para pedir una cita" NO son confirmación de identidad. Si el paciente cambia de tema, el flujo está PAUSADO en confirmación.

2. **FLUJO PARA PACIENTE RECURRENTE reescrito** (línea ~369) — pasos A–E explícitos, prohibición de tools entre solicitud y respuesta del paciente.

3. **`buildExistingPatientSection` reestructurado** (línea ~644) — pasos 1–6 numerados con casos explícitos para "afirmación válida" vs "intención de agendar sin confirmación". Se elimina el step 4 viejo ("todos los datos completos → ve directo") que daba la señal ambigua al modelo.

### 3.3 Refactor mínimo del webhook

Los 4 guards reemplazan ~80 líneas inline en `route.ts` por una iteración `for…of guardResults` (~30 líneas). El primer guard que bloquea aplica su reemplazo y rompe el ciclo.

---

## 4. Tests (`scripts/test-agent-guards.ts`)

```bash
npx tsx scripts/test-agent-guards.ts
```

**Resultado: 54 pasaron · 0 fallaron.**

Cubre:

- **Caso real Lady**: conversación exacta del bug — bloqueada ✅
- **5 variantes** del claim ("ya confirmaste", "gracias por confirmar", "una vez confirmada", "datos confirmados", "identidad confirmada") — todas bloqueadas
- **11 afirmaciones válidas** ("sí", "si", "correcto", "dale", "ok", "listo", "confirmo", "claro", "así es", "esa soy", "Sí, soy yo") — todas aceptadas
- **5 mensajes "no-afirmación"** ("para pedir una cita", "necesito agendar", "quiero una cita", "hola", "cuánto cuesta") — todos detectados
- **4 falsos positivos** (preguntas legítimas de confirmación) — no bloqueados
- **Cancelación**: 5 claims fabricados bloqueados + 1 legítimo permitido + 3 falsos positivos OK
- **Reagendamiento**: 4 claims bloqueados + 3 tool flows permitidos + 2 falsos positivos OK
- **Cita confirmada**: 3 claims sin appointmentData bloqueados + 1 con appointmentData permitido

---

## 5. Auditoría — otros puntos donde el agente espera "sí/no"

| # | Punto del flujo | Riesgo de hallucination | Protección actual |
|---|---|---|---|
| 1 | Confirmación de identidad (paciente recurrente) | **CRÍTICO** — el bug reportado | ✅ Guard 1 nuevo + system prompt |
| 2 | Confirmación final de cita ("¿Confirmas?") → create_appointment | **CRÍTICO** | ✅ Guard 4 (preexistente, unificado) |
| 3 | Cancelación de cita | **ALTO** — paciente pierde cita | ✅ Guard 2 nuevo |
| 4 | Reagendamiento de cita | **ALTO** — datos inconsistentes | ✅ Guard 3 nuevo |
| 5 | Elección de modalidad de pago (particular vs EPS) tras cambio de doctor/tipo | MEDIO — precio incorrecto | ⚠️ Solo system prompt (línea 440 del prompt). Sin guard |
| 6 | Elección de tipo de consulta cuando hay varios | MEDIO — duración/precio incorrectos | ⚠️ Solo system prompt. Sin guard |
| 7 | Modalidad virtual vs presencial | MEDIO — paciente llega al lugar equivocado | ⚠️ Solo system prompt. Sin guard |
| 8 | Confirmación de slot horario | MEDIO — cubierto por Guard 4 si llega a create_appointment | ✅ Implícito |
| 9 | Aceptación de waitlist | BAJO — `add_to_waitlist` es tool, fallaría si no se llama | ✅ Implícito |
| 10 | Respuesta a recordatorio 24h ("sí"/"no") | BAJO — manejado por `handleReminderResponse` ANTES del agente, no por Claude | ✅ Hard-coded |

**Recomendación futura (no en este PR):**
- Considerar guards adicionales para puntos 5, 6, 7 si aparecen incidentes
- Implementar control de concurrencia real (advisory lock por `conversation_id` o buffer de mensajes con ventana de 2s) para eliminar la causa raíz A

---

## 6. Limitaciones conocidas del parche

1. **Race condition no se eliminó** — el guard ataca el síntoma (mensaje fabricado). Si los dos webhooks corren en paralelo, ambos pueden generar respuestas y la segunda puede ser bloqueada por el guard pero el paciente verá el mensaje genérico de "necesito que confirmes". Mejor que el bug original, pero ideal sería evitar el race.

   **Mitigación futura sugerida:** Postgres advisory lock o buffer in-memory por conversación. Requiere diseño separado.

2. **Regex no captura 100% de variantes** — el modelo podría generar frases nuevas que no matcheen (ej. "muy bien, datos ok, te agendo"). El system prompt es la primera línea; el guard es defensa en profundidad. Monitorear `audit_log` con `action LIKE '%_blocked'` para detectar drift.

3. **Falsos negativos en Guard 2/3** — si el modelo dice "tu cita queda cancelada" después de llamar correctamente `cancel_appointment`, el guard la deja pasar (correcto). Pero si Claude llama cancel para la cita A y describe la B, el guard no detecta el cruce de datos. Mitigación: validar que el `appointment_id` del tool match coincide con lo que se menciona. Fuera de scope de este parche.

---

## 7. Próximos pasos

| # | Acción | Quién | Cuándo |
|---|---|---|---|
| 1 | Deploy a producción (Vercel) | Juan | Inmediato |
| 2 | Verificar con Lady un re-test de la conversación | Juan + Lady | Tras deploy |
| 3 | Monitorear `audit_log` por bloqueos durante 7 días | Juan | Semana 1 post-deploy |
| 4 | Decidir si implementar mutex/buffer para race condition | Juan | Tras observar frecuencia real del race |
| 5 | Replicar el patrón de guards para los puntos 5–7 si aparecen incidentes | — | Reactivo |

---

## 8. Archivos modificados

```
M  src/app/api/webhooks/whatsapp/route.ts        (~ -55 líneas, +35 líneas)
M  src/agents/prompts/system-prompt.ts            (~ +35 líneas)
A  src/lib/whatsapp/agent-guards.ts               (módulo nuevo, 152 líneas)
A  scripts/test-agent-guards.ts                   (test, 220 líneas)
A  docs/BUG_CONFIRMACION_IDENTIDAD.md             (este reporte)
```

**Sin migraciones SQL. Sin cambios de dependencias.**

---

## 9. Phase 4 — Verificación

- ✅ TypeScript compila limpio (`npx tsc --noEmit`)
- ✅ 54/54 tests pasan en `npx tsx scripts/test-agent-guards.ts`
- ⏳ Verificación E2E real con WhatsApp pendiente — hacer tras deploy
