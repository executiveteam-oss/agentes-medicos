# Rediseño del flujo de autorizaciones — Design Spec

> **Estado:** Diseño post-piloto. NO construir. La activación del Bloque 4 (recepción de archivos) sigue bloqueada por lo legal (Ley 1581), no por este flujo. Este spec rediseña QUÉ pasa cuando el archivo llega — para cuando legal habilite.

> **Fecha:** 2026-07-27 · **Precede a:** un `writing-plans` posterior, cuando se decida construir.

---

## Principio rector

**La secretaria JUZGA el documento. El agente AGENDA.**

Hoy es al revés: el agente recibe el archivo y se aparta, y la secretaria reconstruye el contexto a mano y agenda escribiendo UUIDs. Eso invierte los roles: pone a agendar a quien NO tiene el contexto (la secretaria) y aparta a quien SÍ lo tiene (el agente, que ya conoce servicio + convenio y sabe ofrecer horarios con `check_availability`).

El rediseño devuelve cada tarea a quien corresponde:
- **Agente**: detecta el requisito, pide el documento, y —tras el visto bueno— retoma y ofrece horarios.
- **Secretaria**: mira el documento con el contexto ya servido, y decide aprobar/rechazar. Nada más.

---

## Diagnóstico que motiva el rediseño (verificado en código, jul-2026)

| # | Problema actual | Evidencia |
|---|---|---|
| 1 | El contexto (servicio/médico/convenio) NO se persiste en columnas; se pierde en la conversación. Al escalar, `conversation.context` se **sobrescribe** con `{escalation_reason}`. | `route.ts:400`, `conversation_media` sin columnas de contexto |
| 2 | El media se etiqueta `authorization` con un **regex sobre el último mensaje del agente**. Si redactó distinto → `document_general` → desaparece de la cola. Pérdida silenciosa. | `route.ts:352-353` |
| 3 | Banner (cuenta media pendiente) y campana (cuenta escalaciones) miden cosas distintas y se desincronizan. Las 2 de prueba llevaron un mes invisibles. | `conversations/page.tsx:104-113` vs `notifyStaffOfEscalation` |
| 4 | La pantalla no muestra qué se pidió; el form de aprobar exige UUIDs a mano. | `authorization-review-list.tsx:227-235` |
| 5 | Aprobar crea la cita directo (`resolved`); el agente no vuelve. | `authorization-review.ts:175-215` |
| 6 | Rechazar no avisa a la paciente (manual). | `authorization-review.ts:243-244` |
| 7 | Sin navegación entre pendientes; la tarjeta revisada queda "se actualizará al recargar". | `authorization-review-list.tsx:61-68` |

**Misma clase de bug que la zona muerta de crisis**: el sistema *adivina* (regex sobre su propio texto) en vez de *registrar* un hecho determinista. El rediseño lo vuelve determinista, igual que la Capa 0.

---

## Arquitectura — el registro estructurado como raíz (Punto 1 + 2)

El corazón del rediseño es una tabla nueva: **`authorization_requests`**. Es el registro determinista de "el agente pidió una autorización para este servicio/convenio", con su ciclo de vida completo. `conversation_media` queda como pura storage de archivos; la lógica de autorización vive en la tabla nueva.

La solicitud es un **hilo lógico** (`authorization_requests`); cada documento que la paciente manda es un **intento** (`authorization_attempts`). Separarlos habilita el historial de rechazos visible en el segundo intento (Punto 2 de los huecos abajo) sin duplicar el contexto.

### Tabla `authorization_requests` (el hilo)

```sql
CREATE TABLE authorization_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id),

    -- CONTEXTO ESTRUCTURADO (el fix raíz — se captura al DETECTAR el requisito,
    -- no al recibir el archivo, y NUNCA se adivina leyendo texto del agente):
    consultation_type_id UUID NOT NULL REFERENCES consultation_types(id),
    doctor_id UUID REFERENCES doctors(id),          -- puede ser NULL si aún no eligió médico
    declared_convenio TEXT NOT NULL,                -- convenio que declaró la paciente
    declared_convenio_normalized TEXT NOT NULL,     -- normalizeConvenioName() para matching

    -- CICLO DE VIDA (refleja el estado del último intento):
    status TEXT NOT NULL DEFAULT 'awaiting_document',
      -- awaiting_document | pending_review | approved | rejected_awaiting_resend
      -- | expired | cancelled
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts_count INTEGER NOT NULL DEFAULT 0,       -- nº de documentos enviados

    -- SEGUIMIENTO "abandonada" (request sin documento — Punto 3 de los huecos):
    last_patient_nudge_at TIMESTAMPTZ,               -- último recordatorio al paciente
    expires_at TIMESTAMPTZ,                          -- awaiting_document caduca acá

    -- Estado post-aprobación / "aprobada sin agendar" (Punto 1 de los huecos):
    reengagement_status TEXT,                        -- NULL | template_sent | patient_replied | scheduled
    reengagement_template_sent_at TIMESTAMPTZ,
    reengagement_retries INTEGER NOT NULL DEFAULT 0, -- reintentos automáticos del template
    unscheduled_alerted_at TIMESTAMPTZ,              -- cuándo se alertó al staff (idempotencia)
    scheduled_appointment_id UUID REFERENCES appointments(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Un solo hilo ABIERTO por conversación+servicio (idempotencia del capture).
-- rejected_awaiting_resend cuenta como abierto: el reenvío se ata al MISMO hilo.
CREATE UNIQUE INDEX uq_auth_req_open
  ON authorization_requests (conversation_id, consultation_type_id)
  WHERE status IN ('awaiting_document', 'pending_review', 'rejected_awaiting_resend');

CREATE INDEX idx_auth_req_pending_review
  ON authorization_requests (clinic_id, status) WHERE status = 'pending_review';
-- Para los crons de seguimiento (abandonada / aprobada-sin-agendar):
CREATE INDEX idx_auth_req_awaiting ON authorization_requests (status, expires_at)
  WHERE status IN ('awaiting_document', 'rejected_awaiting_resend');
CREATE INDEX idx_auth_req_approved_unscheduled ON authorization_requests (status, reengagement_status)
  WHERE status = 'approved' AND scheduled_appointment_id IS NULL;
```

### Tabla `authorization_attempts` (cada documento enviado)

```sql
CREATE TABLE authorization_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES authorization_requests(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,                 -- 1, 2, 3… (historial ordenado)
    media_id UUID NOT NULL REFERENCES conversation_media(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    review_decision TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    review_notes TEXT,                               -- motivo (obligatorio en rechazo)
    reviewed_by UUID REFERENCES clinic_users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_attempts_request ON authorization_attempts (request_id, attempt_number);
```

`authorization_requests` guarda el contexto (una vez); `authorization_attempts` acumula el historial de documentos+veredictos. Quien revisa el intento #2 ve el #1 rechazado con su motivo — sin duplicar contexto ni perder rastro.

### Fix al clobbering de `conversation.context` (Punto 1)

Dos cambios, ambos necesarios:

1. **`conversations.escalation_reason TEXT`** como columna propia (nullable). Hoy el motivo de escalación va dentro del JSONB `context`, y cada `.update({ context: {...} })` **reemplaza todo el objeto**. Sacarlo a su columna elimina la razón principal por la que se sobrescribe context.
2. **Prohibir el overwrite de `context`**: toda escritura a `conversations.context` pasa a ser **merge** (`context = COALESCE(context,'{}') || '{...}'::jsonb`), nunca reemplazo. El estado de autorización NO se guarda en context — vive en `authorization_requests`. El agente lo consulta ahí (ver Punto 5).

Esto es un fix transversal que además cierra fugas futuras de context en cualquier flujo, no solo autorizaciones.

### Captura determinista (Punto 2)

El registro se crea **en el mismo chequeo determinista de la regla `requires_authorization`** que ya existe (capa A `check_eps_convenio` / capa B `BLOCKED_BY_AUTH_PENDING` en `executor.ts`). Cuando ese código detecta que el CT+convenio de la paciente exige autorización:

```
1. UPSERT authorization_requests (conversation_id, consultation_type_id)
   con status='awaiting_document', declared_convenio, doctor_id (si ya elegido),
   requested_at=now(). Idempotente por el índice único parcial.
2. Devuelve al LLM la instrucción de pedir el documento (como hoy).
```

El punto clave: **el registro lo crea el código determinista de la regla, no la redacción del LLM.** El LLM redacta el pedido a la paciente, pero el HECHO "se pidió autorización" ya quedó registrado en la tabla. Análogo a la Capa 0: el regex/regla decide, no el texto del modelo.

### Matching del archivo entrante (reemplaza el regex del Punto 2)

Cuando llega un `image`/`document` por el webhook (flag ON):

```
1. Buscar authorization_requests WHERE conversation_id=?
   AND status IN ('awaiting_document','rejected_awaiting_resend')
   (a lo sumo una, por el índice único).
2. SI existe → es una autorización, con CERTEZA:
   - conversation_media.context = 'authorization'
   - INSERT authorization_attempts (request_id, attempt_number=attempts_count+1,
     media_id=<nuevo media>, review_decision='pending')
   - authorization_requests: status='pending_review', attempts_count+=1
   - escalar + alerta 🛡 (Punto 3). Si ya había alerta viva de un intento previo,
     se refresca (rompe idempotencia, igual que crisis).
3. SI NO existe → document_general (documento previo genérico u otro), flujo existente.
```

Cero regex. Si el sistema no registró un pedido abierto, el archivo no se clasifica como autorización — pero tampoco desaparece: cae en `document_general` que ya escala. La diferencia es que ahora la clasificación como autorización es **determinista y no depende de cómo el agente redactó**.

---

## Punto 3 — Alerta diferenciada atada al DOCUMENTO

Reusar exactamente el patrón de la Capa 0 (🆘 crisis):

- **Tipo nuevo de notificación**: `staff_notifications.type = 'authorization_pending'` (documento esperando juicio). Se agrega al CHECK (migración, igual que `crisis_detected` en la 00082). *(Un segundo tipo, `authorization_unscheduled`, cubre "aprobada sin agendar" — Hueco 1; también se agrega al CHECK. Es menos estridente: es follow-up, no un documento esperando.)*
- **Render diferenciado en la campana**: ícono 🛡, color ámbar/violeta, etiqueta "AUTORIZACIÓN". No se confunde con una escalación genérica.
- **No-limpiable por atender la conversación**: `markAllRead` y el click NO la marcan leída (misma exclusión que `conversation_escalated`/`crisis_detected`). Se limpia **solo** cuando la `authorization_request` pasa a `approved`/`rejected` — vía `resolveAuthorizationNotification(requestId)`, llamada desde las server actions de review.
- **Atada al documento, no a la conversación**: el `metadata` de la notificación lleva `authorization_request_id`. Atender/responder la conversación NO la limpia; solo revisar el documento lo hace. Esto elimina la desincronización banner↔campana del diagnóstico #3.
- **El banner puede quedarse** como vista secundaria, pero deja de ser la única red: la campana ahora es la alerta primaria y distinguida.
- **Cron cleanup**: `authorization_pending` nunca se borra por el cron mientras esté sin revisar (mismo guard que `crisis_detected`, `.neq('type','authorization_pending')` para no-leídas).

Esto cierra el "un mes invisible": una autorización real dispara una alerta 🛡 imposible de perder, que solo se apaga al juzgar el documento.

---

## Punto 4 — Pantalla de revisión = SOLO juzgar

La pantalla pasa de "mini-agendador con UUIDs" a "visor de juicio":

**Muestra (todo desde `authorization_requests` + join):**
- Documento (preview inline img/PDF — ya existe).
- **Contexto de lo que pidió la paciente** (lo nuevo): nombre + teléfono, **servicio** (nombre del CT), **médico** (si eligió), **convenio declarado**, cuándo lo pidió, y un extracto opcional de los últimos N mensajes de la conversación para contexto rápido.
- **Historial de intentos previos** (Hueco 2): si es el 2º+ intento, un bloque colapsable "Intentos previos (N)" con fecha, decisión y motivo de cada rechazo anterior. Sin cambiar de pantalla.

**Acciones — solo dos, sin agendar:**
- **✓ Aprobar**: sin formulario de horario, sin UUIDs. Un click (con confirmación). Dispara el flujo del Punto 5.
- **✗ Rechazar**: exige motivo (≥10 chars, como hoy). Motivo seleccionable de una lista corta pre-definida (ej: "no direccionada a la clínica", "vencida", "ilegible", "otra") + campo libre. La lista pre-definida habilita el mensaje automático del Punto 6.

Se elimina por completo el `ApproveForm` con inputs de UUID. La secretaria nunca vuelve a copiar un UUID.

---

## Punto 5 — Aprobar desescala y devuelve al agente; rechazar hace que el agente explique

### Aprobar

```
approveAuthorization(requestId):  // opera sobre el intento pendiente (el último)
  1. authorization_attempts (último, pending): review_decision='approved', reviewed_at/by
  2. authorization_requests: status='approved'
  3. conversations: status='active'   ← DESESCALA (antes: 'resolved')
     context = context || '{"authorization_approved_for": "<consultation_type_id>"}'  ← MERGE
     escalation_reason = NULL
  4. resolveAuthorizationNotification(requestId)  ← apaga la alerta 🛡
  5. Disparar el retorno del agente (ver Punto 6, según ventana 24h);
     setear reengagement_status='patient_replied' (Caso A) o 'template_sent' (Caso B)
  6. audit_log action='authorization_approved'
```

Ya **no crea la cita**. El agente retoma: en su próximo turno lee la `authorization_request` aprobada de la conversación, sabe el servicio/convenio, y ofrece horarios con `check_availability` — el flujo que ya hace bien. La cita se crea por el camino normal del agente, con `requires_authorization=true` + `authorization_media_id` heredados de la request.

**El agente debe saber que ya no pida el documento de nuevo**: al inicio de cada turno, si existe una `authorization_request` con `status='approved'` y sin cita agendada para esa conversación, el system prompt inyecta "la autorización de {servicio} ya fue aprobada, ofrecé horarios directamente".

### Rechazar

```
rejectAuthorization(requestId, motivo):  // opera sobre el intento pendiente
  1. authorization_attempts (último, pending): review_decision='rejected',
     review_notes=motivo, reviewed_at/by
  2. authorization_requests: status='rejected_awaiting_resend'  ← el hilo sigue ABIERTO
  3. conversations: status='active' (desescala) + context merge
  4. resolveAuthorizationNotification(requestId)
  5. El agente retoma y explica a la paciente QUÉ corregir + pide reenviar
     (según ventana 24h, Punto 6). El reenvío se ata al MISMO hilo como un
     intento nuevo (attempt_number+1) → el historial de rechazos queda visible.
  6. audit_log action='authorization_rejected'
```

El mensaje de rechazo lo redacta el agente a partir del motivo estructurado (no el texto interno crudo). Para motivos de la lista pre-definida hay un mapeo motivo→explicación-amable ("la autorización debe estar direccionada a la clínica; ¿podés pedirle a tu EPS que la direccione a [clínica] y reenviarla?").

El reenvío mantiene la misma `authorization_request` (por eso `rejected_awaiting_resend` cuenta como "abierto" en el índice único): el nuevo documento entra por el matching normal y crea `authorization_attempts` #2. Ver los tres huecos resueltos abajo.

---

## Punto 6 — La ventana de 24h (lo que traba producción si no se resuelve)

WhatsApp solo permite mensajes de forma libre dentro de las **24h** desde el último mensaje de la paciente. La revisión de la secretaria puede caer mucho después (la propia motivación del rediseño es que hoy quedan pendientes por días). Entonces, al aprobar/rechazar, hay dos caminos:

### Caso A — revisión dentro de 24h del último mensaje de la paciente
La ventana está abierta. El agente manda mensaje libre y retoma:
- Aprobado: *"¡Tu autorización quedó aprobada! ¿Qué día te queda bien para tu cita de {servicio}?"* → sigue con `check_availability`.
- Rechazado: *"Revisamos tu autorización y necesitamos que ajustes algo: {explicación}. Cuando la tengas corregida, reenviámela por acá."*

### Caso B — revisión >24h después (ventana cerrada) → TEMPLATE
Fuera de las 24h no se puede iniciar libre. Se necesita **un template UTILITY nuevo aprobado por Meta** que re-abra la conversación. La respuesta de la paciente reabre la ventana de 24h y el agente toma el control con mensajes libres.

**Templates nuevos a someter a Meta (wording BORRADOR — pendiente validación clínica + aprobación Meta):**

```
autorizacion_aprobada (UTILITY):
"Hola {{1}}, ¡tu autorización para {{2}} quedó aprobada! 🎉
Respondé este mensaje y coordinamos el horario de tu cita."
  {{1}} = nombre, {{2}} = servicio

autorizacion_ajuste (UTILITY):
"Hola {{1}}, revisamos tu autorización para {{2}} y necesitamos un ajuste.
Respondé este mensaje y te contamos qué corregir."
  {{1}} = nombre, {{2}} = servicio
```

Al recibir la respuesta de la paciente al template:
- Se marca `reengagement_status='patient_replied'`.
- El agente entra con la ventana abierta: en aprobado, ofrece horarios; en ajuste, explica el motivo concreto (que estaba guardado en `review_notes`) y pide reenviar.

**Por qué no meter el motivo/horarios en el template mismo**: los templates son rígidos (variables limitadas, aprobación lenta) y el motivo de rechazo o los horarios disponibles son dinámicos. El template solo re-abre la puerta; el contenido real lo maneja el agente con mensajes libres una vez la paciente responde. Es el mismo patrón que ya usan los recordatorios.

### Estado "aprobada pero sin agendar"
`reengagement_status` traquea: `template_sent` → `patient_replied` → `scheduled`. Si la paciente no responde al template, la request queda `approved` con `reengagement_status='template_sent'`. **Pendiente de diseño menor**: un recordatorio (reusar el patrón de reactivación) para reintentar el template tras X días, o listarlas en un tablero de "autorizaciones aprobadas sin agendar" para seguimiento manual. Se decide al construir; no bloquea el diseño central.

### Selección del camino (A vs B)
Determinista: `now() - conversations.last_message_at < 24h` → Caso A (libre); si no → Caso B (template). Se evalúa en el momento de aprobar/rechazar.

---

## Punto 7 — Navegación entre pendientes + salida de la lista al revisar

- **Salida optimista**: al aprobar/rechazar, la tarjeta se remueve del estado local inmediatamente (no "se actualizará al recargar"). `revalidatePath` + update optimista del array de items. La tarjeta desaparece; el contador del banner/campana baja en vivo.
- **Navegación**: modo de revisión enfocado — una tarjeta a la vez con "Siguiente ▸ / ◂ Anterior" y contador "3 de 7". Al resolver una, avanza automáticamente a la siguiente pendiente. Alternativa mínima aceptable: mantener la lista apilada pero con remoción optimista y scroll — la navegación prev/next es la mejora, la remoción optimista es el fix obligatorio.
- El estado `done` con "se actualizará al recargar" (`authorization-review-list.tsx:61-68`) se elimina.

---

## Zonas muertas de la máquina de estados (resueltas)

Tres estados pueden dejar a alguien esperando sin que nadie se entere. Cada uno tiene disparo activo, no solo tracking pasivo — misma lección que la zona muerta de crisis: **traquear no alcanza, tiene que avisar** (o cerrar la cola).

### Hueco 1 — "Aprobada pero sin agendar" (la nueva zona muerta principal)

Antes, aprobar creaba la cita. Ahora depende de que la paciente responda para agendar. Si no responde (sobre todo en Caso B, template enviado), no hay cita y nadie se entera. Escalera de seguimiento, corrida por un **cron diario** sobre `status='approved' AND scheduled_appointment_id IS NULL`:

| Momento (desde aprobar) | Acción | Quién |
|---|---|---|
| **24h sin agendar** | Reintento automático **una sola vez** (`reengagement_retries` ≤ 1): si la ventana está abierta, el agente manda recordatorio suave de horarios; si está cerrada, reenvía el template `autorizacion_aprobada`. | Automático (agente) |
| **72h sin agendar** | **Alerta diferenciada al staff**: notificación tipo `authorization_unscheduled` (ícono 📅, ámbar suave) en la campana **+** entra al mini-tablero "Aprobadas sin agendar". `unscheduled_alerted_at` para no repetir. | Staff (seguimiento manual) |
| Después | Queda en el tablero con su **antigüedad visible**. Se auto-resuelve al agendar. Limpiable manualmente si el staff ya contactó. | Staff |

**Decisión sobre "¿alerta diferenciada o pendientes-de-contactar?": las dos.** La alerta en campana (72h) garantiza que no se pierda —la lección del banner pasivo—, y el tablero da el lugar de trabajo para el seguimiento. La alerta es menos estridente que la de documento pendiente (🛡): esto es un follow-up, no un documento esperando juicio.

**No auto-expira en el sistema**, pero: las autorizaciones de EPS en Colombia suelen tener **validez real ~30 días**. El tablero muestra la antigüedad justamente para que el staff persiga antes de que venza en la vida real. (Un aviso extra a los ~25 días queda como mejora opcional, no central.)

### Hueco 2 — Ciclo de reenvío (rechazo → otro documento)

**Mismo hilo, historial de intentos.** El rechazo pone la request en `rejected_awaiting_resend` (sigue abierta). El documento nuevo se ata al mismo `authorization_request` como `authorization_attempts` #2, #3… Quien revisa el segundo intento ve, en la misma pantalla, el intento #1 con su veredicto y motivo de rechazo — así no vuelve a rechazar por lo mismo ni pierde el rastro.

La pantalla de revisión (Punto 4) muestra, sobre el intento pendiente, un **historial colapsable** "Intentos previos (1)": fecha, decisión, motivo, quién revisó. Sin cambiar de pantalla.

Un mismo hilo puede acumular varios rechazos antes de un aprobado o de expirar. Sin límite duro de reintentos (una paciente puede tardar en conseguir la autorización direccionada correcta); si el volumen lo pide, un tope se agrega después.

### Hueco 3 — Request abandonada (la paciente nunca manda el documento)

`awaiting_document` (o `rejected_awaiting_resend`) sin documento nuevo. Cron diario sobre `expires_at`:

| Momento (desde el pedido / último recordatorio) | Acción |
|---|---|
| **~24h sin documento** | Recordatorio suave al paciente (si ventana abierta): *"¿Pudiste conseguir la autorización de {servicio}? Cuando la tengas, mandala por acá."* `last_patient_nudge_at`. Máximo 2 recordatorios. |
| **~7 días sin documento** | La request **expira** (`status='expired'`), se apaga cualquier alerta, sale de la cola. `audit_log`. |

**No alerta al staff** — a diferencia del Hueco 1. Distinción deliberada: *abandonada* = inacción de la paciente (nunca se comprometió con el requisito) → se recuerda y se cierra sola, sin cargar al staff. *Aprobada-sin-agendar* = la clínica ya se comprometió (aprobó un documento) → el staff debe perseguir. La cola nunca se ensucia con requests eternas.

`expires_at` se setea al crear la request (`requested_at + 7 días`) y se **empuja** con cada intento nuevo (el reloj reinicia cuando la paciente muestra actividad). Tras expirar, si la paciente vuelve a pedir el servicio, el capture determinista crea un hilo nuevo — limpio.

Opcional (business insight, no central): contar las expiradas para saber cuántas autorizaciones pedidas nunca llegaron — puede revelar que el requisito ahuyenta pacientes o que el mensaje del agente no es claro.

## Máquina de estados de `authorization_requests`

```
                  (regla requires_authorization detectada)
                              │
                              ▼
              ┌────────▶ awaiting_document ──(7d sin doc)──▶ expired ◀─┐
              │               │                                        │
              │      (llega el documento = attempt #N)                 │
              │               ▼                                        │
              │         pending_review                                 │
              │           │        │                                   │
              │      (aprobar)  (rechazar)                             │
              │           │        ▼                                   │
              │           │   rejected_awaiting_resend ──(7d sin doc)──┘
              │           │        │
              └───(reenvío = attempt #N+1)
                          ▼
                      approved ──(72h sin agendar)──▶ [alerta staff 📅]
                          │                                  │
               (agente agenda la cita) ◀────────────────────┘
                          ▼
                  approved + scheduled   (terminal feliz)
```

Estados terminales: `approved + scheduled` (feliz), `expired` (abandonada, Hueco 3), `cancelled` (staff descarta / paciente pide otra cosa). Todos apagan la alerta. `approved` sin agendar NO es terminal — dispara la escalera del Hueco 1 hasta agendar o hasta que el staff la cierre.

---

## Alcance y NO-alcance

**En alcance del rediseño:**
- Tablas `authorization_requests` (hilo) + `authorization_attempts` (intentos) + captura determinista + matching sin regex.
- Columna `conversations.escalation_reason` + merge-only de `context`.
- Tipos `authorization_pending` + `authorization_unscheduled` + render + no-limpiable + cron guard.
- Pantalla de revisión juzgar-solo + historial de intentos.
- Aprobar/rechazar → desescala + agente retoma.
- Templates `autorizacion_aprobada` / `autorizacion_ajuste`.
- Navegación + remoción optimista.
- Cron de seguimiento (Huecos 1 y 3): reintentos, alerta a staff, recordatorios al paciente, expiración. Puede colgar del cron de recordatorios existente o ser uno nuevo.
- Mini-tablero "Aprobadas sin agendar".

**Fuera de alcance (explícito):**
- **La activación del Bloque 4 sigue bloqueada por lo legal** (Ley 1581: consentimiento reforzado, retención+purga, encriptación del token SEC-001, RNBD, endpoint ARCO). Este rediseño NO desbloquea nada legal — solo mejora el flujo para cuando legal habilite.
- Encriptación del token de WhatsApp (SEC-001) — precondición de activación, no parte de este flujo.
- El input "agregar convenio manual" para reglas (deuda ya anotada) — necesario para configurar la regla, pero es otra pieza.
- El tablero de "aprobadas sin agendar" — se decide al construir.

---

## Testing (cuando se construya)

- **Captura determinista**: regla detectada → existe `authorization_request` con el CT/convenio correcto, sin depender del texto del LLM. Test del upsert idempotente (dos detecciones → una sola request abierta).
- **Matching sin regex**: archivo entrante con request abierta → `authorization`; sin request → `document_general`. Sin mirar el texto del agente.
- **No-clobbering de context**: escalar no borra claves previas de `context`; `escalation_reason` en su columna.
- **Alerta atada al doc**: atender/responder la conversación NO limpia `authorization_pending`; solo aprobar/rechazar lo hace. Cron no la borra.
- **Aprobar desescala**: `status='active'`, el agente en el próximo turno ofrece horarios (no re-pide el documento). Snapshot del prompt con el flag `authorization_approved_for`.
- **Ventana 24h**: <24h → mensaje libre; >24h → template. Selección determinista por `last_message_at`.
- **Rechazo**: el agente explica el motivo estructurado, no el texto interno crudo.
- **Remoción optimista**: tarjeta desaparece sin reload; contador baja.
- **Regresión** (misma clase que la zona muerta): una autorización recibida en una conversación ya escalada por otro motivo se clasifica y alerta igual.
- **Hueco 1 (aprobada sin agendar)**: cron a 24h → 1 reintento; a 72h → alerta `authorization_unscheduled` + tablero, `unscheduled_alerted_at` evita duplicar; se auto-resuelve al agendar.
- **Hueco 2 (reenvío)**: rechazo → `rejected_awaiting_resend` (hilo abierto); documento nuevo → `authorization_attempts` #2 en el MISMO hilo; la pantalla del intento #2 muestra el #1 rechazado.
- **Hueco 3 (abandonada)**: sin documento → recordatorio a 24h (máx 2), expira a 7d (`status='expired'`, alerta apagada, fuera de cola); `expires_at` se empuja con cada intento.

---

## Decisiones tomadas (marcá si querés cambiarlas)

1. **Tabla nueva `authorization_requests`** en vez de estirar `conversation_media`. Razón: separa storage (media) de lógica de negocio (autorización), y da lugar limpio para el ciclo de vida + contexto estructurado.
2. **Captura anclada a la regla determinista** (mismo chequeo de capa A/B), no a un tool que el LLM decide llamar. Razón: cumple "registrar, no adivinar" del Punto 2 sin depender del criterio del modelo.
3. **El estado de autorización vive en la tabla, no en `conversation.context`.** El agente consulta la tabla cada turno. Razón: evita depender de un JSONB que históricamente se sobrescribe.
4. **Dos templates separados** (aprobada / ajuste) en vez de uno genérico. Razón: la paciente entiende de qué se trata desde el primer mensaje; el contenido dinámico va después en libre.
5. **El motivo de rechazo se estructura (lista + libre)** para habilitar el mensaje automático amable. Razón: el texto interno crudo no siempre es apto para la paciente.
6. **Hilo + intentos** (`authorization_requests` + `authorization_attempts`) en vez de una request por documento. Razón: el reenvío tras rechazo mantiene el historial visible (Hueco 2) sin duplicar contexto.
7. **Umbrales de seguimiento** (ajustables — son los que propongo, no dogma): aprobada-sin-agendar → reintento auto a **24h**, alerta staff a **72h**; abandonada → recordatorio a **24h** (máx 2), expira a **7 días**. Validez EPS real ~30 días como señal de urgencia en el tablero. Si Lady prefiere otros números, se cambian sin tocar la arquitectura.
```
