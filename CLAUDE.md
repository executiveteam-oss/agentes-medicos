# CLAUDE.md — Omuwan

> Agente de IA por WhatsApp para consultorios médicos en Colombia. SaaS B2B multi-tenant.

---

## 📐 REGLA DE ESTE DOCUMENTO

**Si un dato vive en la base de datos, acá NO se copia — se consulta.**

Nombres de médicos, horarios, qué convenios piden autorización, `clinic_id`, teléfonos,
`phone_id`, nombres de templates aprobados, conteos de pacientes o citas: **nada de eso va acá.**
Todo lo que se duplica en un documento diverge en silencio, y un dato viejo leído con confianza
es peor que no tener el dato — manda a arreglar lo que no está roto.

Acá van **invariantes del sistema**: cosas que son verdad porque el código las hace verdad.
Si cambia el código, cambia este documento en el mismo commit.

Contexto durable de un cliente concreto (quién es, cómo opera, de dónde migra) va en su propio
doc: `docs/CLIENTE_<NOMBRE>.md`. Ahí tampoco se copia estado de la DB.

---

## 🧠 LOS PATRONES QUE APRENDIMOS A LOS GOLPES

Esta sección es la más importante del documento. Cada línea salió de una falla real en
producción. Parecen anécdotas: son reglas de diseño, y aplican a cualquier clínica.

### 1. Instrucción al modelo falla. Estructura funciona.

Si algo **tiene que** pasar, no puede depender de que el LLM lea una instrucción del prompt y
la obedezca. El prompt es capa A (mejora la conversación); la estructura determinista es capa B
(garantiza el resultado). Toda garantía real vive en código: un detector antes del modelo, un
backstop en el executor, o un guard después de la respuesta.

Corolario práctico: cuando aparezca un bug del tipo "el agente dijo/hizo algo que no debía", la
pregunta no es *"¿cómo reescribo el prompt?"* sino *"¿qué estructura faltaba?"*. El prompt se
ajusta además, nunca en lugar de.

**Y el error más fácil de cometer es aplicarlo A MEDIAS: blindar la acción y dejar la
recuperación en una instrucción.** Es el mismo bug con otra ropa, y es peor porque el commit
se siente terminado.

Pasó el 2026-08-20, dentro del cambio que estaba invocando este patrón. Se cerró por estructura
que el agente pudiera ESCRIBIR una cita fuera del horario del médico — hasta ahí bien. Pero el
rechazo devolvía `message_for_patient: "Ese horario no está dentro de la agenda del médico.
¿Buscamos otro?"` y un `instruction_for_llm` que le pedía al modelo buscar horarios y ofrecerlos.
O sea: la mitad que impide está en código, y la mitad que resuelve depende de que el modelo
obedezca. Y como ese bloqueo dejó de escalar, ese texto ni siquiera se enviaba: el modelo
redactaba lo que quería.

La pregunta que lo detecta: **después del bloqueo, ¿qué lee la paciente, y quién lo garantiza?**
Si la respuesta es "el modelo debería", falta estructura. Un "no se puede" es sólo la mitad de
una respuesta; la otra mitad son las opciones que sí existen, y tienen que venir del código —
en este caso, los cupos reales del médico devueltos junto al bloqueo.

Vale para todo `BLOCKED_BY_*`: el que bloquea es el que tiene que traer la salida.

### 2. Una sola función por pregunta.

*"¿Este cupo está libre?"* no puede tener cuatro implementaciones. Cuando la misma pregunta se
responde en dos lugares, los dos divergen — siempre, y en silencio. Todo lo que perdimos por
regresiones fue este patrón.

Fuentes únicas que ya existen y **no se duplican**:

| Pregunta | Fuente única |
|---|---|
| ¿El cupo está libre? | `isSlotFree` + `BUSY_STATUSES` (`src/lib/calendar/slot-availability.ts`) |
| ¿Qué contexto ve el agente? | `src/lib/agent/agent-context.ts` (webhook y "devolver al agente" lo importan) |
| ¿Falló un envío de WhatsApp? | `sendWhatsAppMessageWithResult` → `recordWhatsAppSendFailure` (`src/lib/whatsapp/send-failure.ts`) |
| ¿Cuál es la config por defecto de una clínica? | `src/lib/whatsapp/default-config.ts` |

Antes de escribir una función nueva que responda una pregunta que el sistema ya se hace:
buscala. Si existe, importala. Si está en el lugar equivocado, movela — no la copies.

Y cuando una decisión sea una **lista** (qué estados ocupan cupo, qué alertas se limpian, qué
tipos de envío alertan), va como constante exportada, no como `if` disperso. Así el caso que
agreguemos el mes que viene lo hereda solo.

### 3. La alerta de crisis no se limpia nunca.

`ALERTS_CLEARED_ON_ATTEND` (`src/lib/notifications/escalation-notify.ts`) contiene **solo**
`conversation_escalated`. Una alerta de crisis no está en esa lista y no se limpia al atender la
conversación: se apaga con una acción explícita de una persona, no como efecto secundario de
abrir un chat.

**No agregar tipos de crisis a esa lista.** Una alerta que desaparece sola es una alerta que
nadie vio.

### 4. Una escalación no se devuelve sola al agente.

No existe — y no se vuelve a construir — ningún mecanismo que devuelva al bot una conversación
escalada por vencimiento de tiempo. Ni con lista blanca. Devolverle el bot a alguien que pidió
hablar con una persona es el peor caso posible, no el más seguro.

Lo que sí corre por tiempo/insistencia es **re-alertar** al staff (one-shot), y un mensaje nuevo
del paciente sobre una conversación pendiente la re-sube a Atención. La salida de una escalación
es siempre una acción humana explícita.

### 5. Nunca se inserta una cita sin `consultation_type_id`.

Una cita con `consultation_type_id` null queda rota: sin precio, sin duración real, sin reglas
aplicables y sin dato reportable. El executor resuelve el tipo cuando hay exactamente uno
agendable, y **bloquea** cuando hay varios y el agente no lo mandó — devolviéndole al modelo la
lista de opciones para que pregunte. Nunca defaultea: agendar el servicio equivocado con el
precio y la duración equivocados es peor que no agendar.

### 6. Deployado ≠ funciona.

"El typecheck pasó", "el build salió verde" y "el deploy está READY" no son evidencia de que la
funcionalidad funcione. Verificar siempre contra algo contrastable: el comportamiento observado
en la pantalla o en el chat, una fila en la DB, un registro en `audit_log`, la respuesta real de
una API.

Dos casos que costaron caro:
- Un fix de realtime "deployado" que nunca había funcionado en ninguna versión — recargar la
  página tapaba el bug, porque el render del server trae los datos por otro camino.
- Un cron que corre y sale verde procesando **cero** filas. Verde no es verificado: si el
  conteo de entrada es cero, no ejercitó nada. Antes de declarar que un cron funciona, contar
  las filas que va a tocar; si son cero, fabricar el caso.

Y al esperar algo externo (un deploy, un build): **timeout duro**. Nunca un bucle de espera sin
corte — si no responde en el intervalo previsto, se reporta, no se cuelga.

### 7. El prompt no afirma comportamiento del sistema.

Si algo depende de que el código funcione, **lo reporta el código, no el prompt**. Una frase del
prompt que describe lo que "el sistema hace" es una afirmación sin verificación: sigue diciendo
lo mismo cuando el código cambia, cuando falla, y cuando nunca existió. Y el modelo la repite con
total seguridad, porque se la dimos como verdad.

Nos mordió cuatro veces, y las cuatro son la misma forma:

| Lo que el prompt afirmaba | Lo que pasaba de verdad |
|---|---|
| Los días que atiende un médico | Los inventaba: ningún tool los devolvía |
| *"si el tool devuelve vacío, la paciente NO tiene citas… aunque ella insista"* | Un no-encuentro convertido en certeza. Le dijo "no tengo registrada una cita tuya" a una paciente con tres citas al día siguiente |
| *"el sistema enviará el link de videollamada automáticamente"* | El cron `sendVirtualLinks` SÍ existe — pero exige `virtual_link` no nulo, y **nada lo llena nunca**: ni el agente ni el executor lo escriben. El mecanismo está y no puede dispararse |
| *"Cierra SIEMPRE avisando del archivo de calendario"* | El .ics se genera después y puede fallar; la promesa salía igual |

La forma correcta es al revés: **el dato entra al prompt desde una tool, o el mensaje lo emite el
código después de que el hecho ocurrió.** El aviso del `.ics` no lo dice el agente en la
confirmación — lo dice el mensaje que sale cuando el archivo ya existe. Los días de un médico no
los recita el modelo — se los devuelve `check_availability`.

Y si una capacidad depende de configuración (videollamada, plataforma, convenio), la pregunta
"¿esta clínica puede?" va como **función única** que consultan el prompt y el executor. Si cada
uno decide por su cuenta, el agente promete lo que el executor después rechaza.

Corolario para revisar: buscá en el prompt las frases con "el sistema", "automáticamente",
"siempre" y "recibirás". Casi todas son candidatas.

### 8. Una pantalla no muestra un dato distinto del que usa para ordenar.

Cuando no coinciden, **la lista se ve rota aunque el orden sea perfecto** — y nadie desconfía del
texto: todos desconfían del orden. Es una trampa cara porque manda a revisar el `sort`, que está
bien, en vez del renglón que miente.

Nos mordió dos veces el mismo día, en dos pantallas distintas:

| Pantalla | Ordena por | Mostraba | Consecuencia |
|---|---|---|---|
| Conversaciones | la fecha del **pendiente** (servicio marcado, orden pedida) cuando hay uno | siempre `last_message_at` | "Esperando hace 1 día" arriba de "hace 2 días". Sobre 7 filas reales el sort era exacto y sin un solo empate |
| Campana | `refreshed_at` (la alerta se refresca cuando la paciente vuelve a escribir) | `created_at` | **232 de 576** notificaciones desfasadas, hasta **150 horas** de diferencia. Una alerta subía al tope diciendo "hace 6 días" |

La forma de que no vuelva: **el valor que se muestra se deriva de la misma función que ordena.**
En `conversations-panel` eso es `relojDeEspera` sacando su fecha del mismo criterio que
`waitingMs` — no dos expresiones que casualmente coinciden hoy, sino una sola fuente. Es el
patrón 2 aplicado a la UI: la pregunta "¿hace cuánto espera esta fila?" se responde en un solo
lugar.

Y si de verdad hacen falta dos números distintos en la misma fila, que digan cosas distintas: el
badge del pendiente perdió su reloj porque repetía el de al lado, y dos números diciendo lo mismo
es de donde venía la confusión.

**Corolario práctico:** cuando alguien reporte *"esta lista está desordenada"*, lo primero no es
mirar el `sort` — es **verificar si el número que se muestra es el que ordena**. Las dos veces
que pasó, el orden estaba bien.

**Y al arreglarlo: contar los tiempos de la fila. No alcanza con corregir el que reportaron.**
En Conversaciones se corrigió el reloj de la izquierda —el que alguien señaló— y quedó vivo un
SEGUNDO reloj a la derecha, con `last_message_at`, tres líneas más abajo en el mismo archivo. Se
leía "1 día, 2 días, 21 horas, 12 horas" y la lista volvía a parecer rota. Una fila tiene UN
tiempo: el que explica su posición. Si hay otro dato temporal que alguien necesita, va en el
detalle, no en la lista.

### 9. Si un dato vive en la DB, no se copia al doc.

Ver la regla de arriba. Está acá también porque es la misma clase de error que las otras seis:
una fuente de verdad duplicada que diverge sin avisar.

---

### 10. El texto para la paciente es el que el modelo emite cuando ya no va a llamar más tools.

`src/lib/agent/contrato-de-salida.ts` — **una sola función decide qué lee la
paciente**, y el loop no arma texto por su cuenta.

Durante meses el mensaje se armaba acumulando el texto de TODAS las vueltas del
loop (`collectedTexts.push()` por iteración → `join('\n\n')`). No había ninguna
marca que separara "esto es para la paciente" de "esto es el modelo pensando en
voz alta", así que cada narración interna salía por WhatsApp: *"Tienes razón.
Debo llamar create_appointment ahora."*, *"Déjame obtener primero el ID de la
cita actual"*. La defensa era `strip-internal-monologue`, una lista de patrones
que crecía con cada caso — íbamos siempre un caso atrás.

**La marca no había que pedírsela al modelo: ya estaba en la estructura del
loop.** El modelo emite texto en dos posiciones y significan cosas distintas:
en una vuelta que **cierra** (`end_turn`) ya no le falta información y eso es su
respuesta; en una vuelta que sigue con un `tool_use` dijo algo y acto seguido fue
a buscar un dato — es preámbulo. De ahí las reglas, en orden:

```
0. Si una vuelta llamó escalate_to_human → el texto de ESA vuelta.
1. Si no: la vuelta que cerró el turno, si dijo algo.
1-bis. …salvo que ese cierre no pregunte NADA y un bloque descartado sí
   preguntara: entonces van los dos (la pregunta no puede quedar colgada).
2. Si no: lo ÚLTIMO que alcanzó a decir antes de una tool.
3. Si no: el fallback.
```

La regla 0 existe porque el prompt le exige hablarle a la paciente ANTES de
llamar `escalate_to_human`: ese texto pre-tool es el único que ella va a leer.

**Medido en sombra sobre los 1.020 turnos reales del 14 al 21 de agosto de 2026**
(`scripts/sombra/replay-contrato-salida.mts`): 0 turnos sin respuesta, 0 mensajes
que ganen texto, 210 bloques descartados —34 eran el eco del marcador
`[fecha hora]`, 168 preámbulos, 8 con contenido propio y de esos 3 eran datos que
el modelo inventaba y después se corregía—. Los turnos armados con más de una
fuente pasaron de 188 a 0: **el bug de orden desaparece por construcción**, ya no
puede salir el "✅ confirmada" antes del "¿confirmas?".

Dos cosas que NO cambiaron y no hay que "ordenar":

- **`strip-internal-monologue` se queda.** Bajó el problema, no lo eliminó:
  quedan turnos donde el modelo se narra *dentro* del texto de cierre. Es red de
  seguridad, no la defensa principal.
- **La regla 1-bis es la única excepción, y se hizo a propósito que sólo pueda
  AGREGAR texto, nunca quitarlo.** Su peor caso es un preámbulo de más. No se
  agregan más excepciones: cada heurística nueva es un paso de vuelta a la lista
  de patrones de la que salimos. Hay un caso conocido y aceptado —un mensaje que
  termina con "Nuevamente, disculpa el error" sin que la primera disculpa esté en
  el mismo mensaje— y se deja raro.

Cada decisión del contrato que descarta algo queda en `audit_log`
(`contrato_salida_descarto` + `origen` + los bloques recortados). Es la fuente
para contestar después *"¿esto le está borrando algo a alguien?"* con evidencia.

---

## 🏗️ Stack

```
Next.js (App Router) + TypeScript   →  Vercel
Supabase (PostgreSQL + Auth + Realtime + Storage)
WhatsApp Business Cloud API (Meta)
Claude API (Anthropic) — modelo en src/lib/anthropic/client.ts
Tailwind CSS + shadcn/ui  ·  Zod  ·  date-fns + date-fns-tz  ·  Playwright (scraping)
```

Un solo proyecto fullstack, DB managed, deploy sin servidores. El modelo concreto y sus
parámetros (max tokens, temperature, caching) viven en `src/lib/anthropic/client.ts` — no se
copian acá.

---

## 📨 EL FLUJO DEL MENSAJE ENTRANTE

`src/app/api/webhooks/whatsapp/route.ts`. **El orden es el diseño**, no una casualidad:

1. **Verificar firma HMAC** del webhook de Meta e identificar la clínica por `phone_number_id`.
2. **Buscar o crear el paciente**; abrir o recuperar la conversación.
3. **Sanitizar** el texto del paciente antes de que toque el LLM.
4. **Cargar historial ANTES de guardar el mensaje actual** — si se guarda primero, el mensaje
   llega duplicado al modelo (una vez del historial, otra del push explícito).
5. **Guardar el mensaje** y bumpear `conversations.last_message_at`.
6. **🛡 CAPA 0 — determinista, antes del LLM.** Detección por patrones, sin modelo de por medio.
   Precedencia explícita, y ante la duda se escala:

   `crisis` → `derecho ARCO sobre datos` → `consulta de política de privacidad` →
   `servicio con regla escalate_human` → `pedido explícito de humano`

   Cada una responde, escala y **corta** el flujo.
7. **Corte por conversación escalada**: si un humano ya se hizo cargo, el agente no responde.
   Refresca la alerta con el último mensaje y devuelve la conversación a Atención si insistía.
8. Respuesta a recordatorio (sí/no) y respuesta NPS.
9. **Gate de consentimiento**: paciente sin `data_consent_at` recibe el aviso de privacidad.
10. Keywords de escalación configuradas por la clínica.
11. **Recién acá corre el agente** (LLM + tools).
12. **Guards de alucinación** sobre la respuesta generada, antes de enviarla.
13. Envío por WhatsApp — siempre por el wrapper que registra los fallos.

### Por qué la Capa 0 va primero

Va **antes del corte por escalada** y **antes del gate de consentimiento** a propósito:

- Una persona en crisis que escribe a una conversación ya escalada, o sin haber aceptado todavía
  el aviso de privacidad, **igual tiene que recibir las líneas de ayuda**. Cualquier gate previo
  la dejaría sin respuesta en el peor momento posible.
- Un derecho ARCO es una obligación legal: no puede quedar detrás de un flag configurable ni
  depender de que el modelo lo interprete.
- Un servicio que la clínica reservó para validación humana se escala **antes de que el LLM
  redacte**, para que no exista el turno en que promete agendarlo.

Es el caso más puro del patrón 1: son garantías, así que no dependen del modelo.

---

## 🔒 EL EXECUTOR COMO BACKSTOP DURO

`src/agents/tools/executor.ts` ejecuta las tools del agente y es la **última línea antes de
escribir en la DB**. Aunque el prompt falle, aunque el detector no matchee, aunque el modelo
alucine: acá se bloquea.

Los bloqueos devuelven un error tipado `BLOCKED_BY_*` que vuelve al loop del modelo con la
instrucción de qué preguntar o cómo derivar — no un mensaje de error al paciente.

### Reglas por tipo de consulta

Tabla `consultation_type_rules`. El `CHECK` admite seis `rule_type`; **cuatro tienen backstop
bloqueante implementado** en el executor:

| `rule_type` | Backstop | Qué hace |
|---|---|---|
| `escalate_human` | ✅ `BLOCKED_BY_RULE_ESCALATE_HUMAN` | El servicio lo maneja una persona; el agente no lo agenda |
| `age_limit` | ✅ `BLOCKED_BY_AGE_*` | Rango etario; edad desconocida también bloquea |
| `patient_condition` | ✅ `BLOCKED_BY_CONDITION_*` | Condición del paciente; **ambiguo → derivar** (safe default) |
| `requires_authorization` | ✅ `BLOCKED_BY_AUTH_PENDING` | Exige autorización direccionada del convenio |
| `special_message` | ❌ sin implementar | Existe en el `CHECK` y en los tipos, sin lógica |
| `clinical_doc_review` | ❌ sin implementar | Ídem |

Acciones posibles: `derivar_humano`, `informar_y_agendar`, `informar_y_derivar`, `rechazar`.

Todo bloqueo queda en `audit_log` (`create_appointment_blocked_by_rule` + `rule_type` +
`outcome`), que es la fuente para responder después *"¿cuántos rechazamos y por qué?"*.

### Drift de datos, no de código

La lista curada de keywords de la escalación determinista se desincroniza en silencio cuando
alguien agrega una regla `escalate_human` desde el dashboard. Por eso existe el cron
`escalate-coverage-check`: compara diario la DB viva contra la cobertura del detector y **falla
con 500** si algo quedó descubierto. Un test de CI no lo atraparía — el drift es de datos, no de
código.

---

## 🕵️ GUARDS DE ALUCINACIÓN

`src/lib/whatsapp/agent-guards.ts` — funciones puras, testeables sin DB. Detectan que el agente
**afirmó** algo que no ocurrió:

1. Identidad confirmada sin que el paciente la haya afirmado.
2. Cancelación anunciada sin haber llamado `cancel_appointment`.
3. Reagendamiento anunciado sin haber llamado `reschedule_appointment`.
4. Cita confirmada sin datos reales de cita.

El guard 4 **corrige al modelo, no al paciente**: al detectar la alucinación devuelve la
corrección al loop ("dijiste que quedó confirmada y no llamaste `create_appointment`; llamala
ahora") y re-corre el turno. El paciente hizo todo bien; pedirle que repita el horario por un
error del modelo es trasladarle un problema nuestro.

Las tools disponibles están definidas en `src/lib/anthropic/tools.ts` (`check_availability`,
`create_appointment`, `get_patient_appointments`, `cancel_appointment`, `reschedule_appointment`,
`escalate_to_human`, `add_to_waitlist`, `calculate_date`, `check_eps_convenio`,
`get_consultation_price`). El system prompt vive en `src/agents/prompts/system-prompt.ts` — no se
transcribe acá, se lee del archivo.

---

## 🗄️ MODELO DE DATOS

El esquema vivo se consulta (`supabase/migrations/`, o `list_tables` del MCP). Acá solo el mapa
de entidades y las relaciones que hay que tener en la cabeza:

```
clinics (tenant raíz)
├── doctors ──── consultation_types ──── consultation_type_rules
│                       └── consultation_type_schedules
├── patients ──── appointments ──── reminders
├── conversations ──── messages
├── clinic_users ──── clinic_roles (permisos por rol)
└── audit_log
```

**Todo cuelga de `clinics`.** Cada query filtra por `clinic_id`, sin excepción.

Configuración por clínica, toda dentro de `clinics`:
- `feature_config` (JSONB) — flags maestros por feature (`agent`, recordatorios,
  `media_reception_enabled`, `survey_post_consulta_enabled`, `res256_enabled`,
  `consultation_type_rule_enabled`, `claim`, retención…).
- `whatsapp_config` (JSONB) — horario de atención, keywords de escalación, config de crisis,
  automatizaciones. Validado con Zod; los defaults viven en `src/lib/whatsapp/default-config.ts`.

**Campos derivados de `messages`:** el único cacheado es `conversations.last_message_at`, que se
bumpea dentro de `saveMessage`. El resto (último rol, preview, conteo, no leído) se deriva en
vivo y por diseño no puede quedar desfasado. Si alguna vez se agrega otro campo cacheado, se
bumpea en el mismo lugar o vuelve el mismo bug.

---

## 🏢 MULTI-TENANT Y PERMISOS

- **RLS activo en todas las tablas.** El dashboard lee mayormente con `service_role` desde el
  server, pero Realtime evalúa RLS con el JWT del usuario: un canal puede decir `SUBSCRIBED` y no
  entregar ni una fila si el socket no está autenticado. Por eso se llama
  `realtime.setAuth(token)` **antes de cada suscripción**, no solo al refrescar el token.
- **🚨 Antes de agregar una tabla a la publicación `supabase_realtime`, revisá su política RLS.**
  La mayoría de las políticas de este esquema resuelven la clínica por subconsulta a
  `clinic_users` o a `doctors`, y **esas dos tablas tienen políticas auto-referenciales**
  (`clinic_users` consulta `clinic_users`). Evaluarlas como `authenticated` levanta
  `42P17 infinite recursion`, y **una política que lanza excepción se ve idéntica a "no hay filas
  visibles"**: el canal conecta, no llega nada, y no hay error en el cliente. Con `service_role`
  no se nota nunca, porque saltea RLS.
  La política de la tabla que se publique tiene que resolver la clínica con
  `public.get_user_clinic_id()` (SECURITY DEFINER, corta la recursión). Inventario vivo de las que
  siguen con el patrón roto: `docs/RLS_RECURSION_BACKLOG.md` — **`appointments` ya está publicada
  en Realtime y todavía recursa**; es la próxima que va a chocar.
- **Roles sembrados** (`src/lib/seed-roles.ts`): Admin, Doctor, Coordinadora, Secretaria,
  Contador. Cada permiso es `{read, write}` por área.
- **⚠️ Deuda que NO se debe "ordenar":** las server actions de doctores, tipos de consulta,
  horarios y fechas bloqueadas usan `checkWritePermission('whatsapp')`, no `'settings'` — herencia
  de cuando las rutas vivían bajo `/dashboard/whatsapp/`. Cambiarlo a `'settings'` por estética
  **deja solo a Admin** editando médicos y le saca el acceso a Coordinadora de un día para otro.
  Si se refactoriza: primero migrar los permisos del rol, después cambiar el gate, y verificar con
  el cliente que nadie perdió acceso. Nunca uno sin el otro.
- Deuda menor: `invitations.role_id` no tiene FK a `clinic_roles(id)` (sí la tiene
  `clinic_users`). Los relation embeds de PostgREST contra `clinic_roles` **fallan en silencio**
  desde `invitations` — por eso ahí se hacen dos queries y se mergea. Cualquier query nueva contra
  esa tabla tiene que repetir el patrón hasta que exista la FK.

---

## ⏰ CRONS

Definidos en `vercel.json`, implementados en `src/app/api/cron/`. Todos protegidos por
`CRON_SECRET`:

| Cron | Qué hace |
|---|---|
| `send-reminders` | Recordatorios de cita (varias ventanas, filtros internos) |
| `survey-post-consulta` | Encuesta de satisfacción por template |
| `post-consulta` | Followup NPS conversacional (legacy) |
| `reactivacion` | Pacientes inactivos |
| `morning-report` / `weekly-report` | Reportes al staff |
| `reopen-agendas` | Reabre agendas cuyo cierre venció |
| `cleanup-notifications` | Limpieza de notificaciones viejas |
| `escalate-coverage-check` | Detecta drift de la escalación determinista (falla con 500) |
| `document-retention` | Purga de documentos vencidos — **ver abajo** |
| `sync/isalud` | Sync de agenda del HIS (solo clientes en migración) |

**`document-retention` es el único cron que destruye datos.** Corre en **dry-run por defecto**:
solo borra si `DOCUMENT_RETENTION_DELETE_ENABLED === 'true'`. No se prende sin decisión explícita
del cliente y verificación previa de qué filas alcanzaría.

**Los envíos proactivos requieren `patients.proactive_contact_opt_in`.** Es opt-in de canal
(distinto de `data_consent_at`, que es consentimiento de tratamiento de datos): si está en false,
no sale recordatorio ni encuesta ni reactivación. Prenderlo en masa es decisión del cliente.

Un cron de baja frecuencia que se modifica se prueba **ejecutándolo a mano** contra datos reales
antes de confiar en su próximo ciclo natural — y contando primero cuántas filas va a tocar.

---

## 🇨🇴 COLOMBIA — REGULATORIO

**Ley 1581/2012 (habeas data).** Los datos de salud son dato **sensible**:

1. Aviso de privacidad en el primer contacto; sin consentimiento no se conversa.
2. Derechos ARCO operativos — hay Capa 0 para detectarlos y un runbook de borrado
   (`docs/RUNBOOK_BORRADO_ARCO.md`).
3. Registro de las bases de datos en el RNBD (SIC).
4. Secretos solo en `.env`. Nunca loggear teléfonos completos ni documentos.
5. Rate limiting en webhooks y API (`docs/RATE_LIMITING.md`).
6. `audit_log` para toda acción crítica. Cada acceso del staff a un documento clínico se registra
   individualmente — para documentos clínicos el registro completo es protección legal, no ruido.

**Resolución 256 de 2016 (MinSalud).** Reporte semestral descargable desde el dashboard, detrás
de `feature_config.res256_enabled`. Lógica pura y testeable en
`src/lib/reports/resolucion-256/`. Manual: `docs/REPORTE_RES256.md`.

> 🚨 **Pendiente antes del primer reporte que se envíe a PISIS:** los códigos de la tabla
> `eapb_codes` provienen de un seed que **no fue auditado** contra el catálogo oficial SISPRO.
> Hay indicios de códigos cruzados y de un prefijo inventado para prepagadas. Auditar contra el
> catálogo oficial antes de que cualquier clínica genere un reporte real.

**Convenciones locales:** COP sin decimales (`$150.000`), celular `+57` almacenado y
`3XX XXX XXXX` mostrado, documentos CC/TI/CE/PP/RC/PA/MS/AS, EPS y prepagadas,
`America/Bogota` (UTC-5) siempre, fechas DD/MM/YYYY, horas 12h AM/PM.

**El registro es TUTEO colombiano.** Ni voseo ni "usted". Esto estuvo mal escrito
en este documento hasta el 2026-08-19 —decía "voseo consistente"— y el error se
filtró a mensajes reales: un aviso de cita reprogramada le decía a la paciente
"acá podés actualizarla". El voseo es rioplatense; una paciente de Pereira lo lee
como que le escribe un extranjero. La regla ya estaba bien escrita en
`src/lib/chatbot/system-prompt.ts` ("Tuteo al usuario. NO uso voseo.") y en el
system prompt del agente — este documento era el que discrepaba.

> **🔴 El registro NO se contagia sólo desde el system prompt: lo fija CUALQUIER
> texto que el modelo lea.** Incluidas las notas internas de los guards, que
> nadie piensa como "texto de producto" porque la paciente no las ve.
>
> Pasó el 2026-08-21 construyendo el guard 10. La nota de corrección que se le
> reinyecta al modelo estaba escrita en voseo —"Llamá check_eps_convenio",
> "si no tenés el insurer_type"— y en la corrida siguiente el modelo le escribió
> a la paciente:
>
> > *"**Tenés** razón. Disculpa — necesito verificar eso con el consultorio."*
>
> El system prompt decía tuteo. La nota decía voseo. Ganó la nota, que era lo
> último que había leído.
>
> **Dónde buscar cuando aparezca otro caso**, porque no es un solo archivo: las
> notas de `selfCorrection` de los guards 4, 6 y 10 (`route.ts`), los
> `instruction_for_llm` y `message_for_patient` del executor, y los textos
> deterministas del webhook. Los dos de `route.ts` que decían *"Disculpá, quiero
> confirmarte los horarios exactos…"* llegaron a producción y una paciente los
> recibió el 19/08.
>
> La regla operativa: **si el modelo lo lee, va en tuteo** — no importa que sea
> "interno".

---

## 🚨 DEUDAS ESTRUCTURALES DEL PRODUCTO

### 🔴 Un usuario, una clínica — RESOLVER ANTES DE VENDER EL SEGUNDO CLIENTE

`public.get_user_clinic_id()` resuelve la clínica del usuario con **`LIMIT 1`**. Es la función de
la que dependen las políticas RLS de `conversations`, `messages` y `pending_contacts`: es la que
decide **qué tenant ve cada persona en el navegador**.

Con dos membresías activas, **elige una y calla**. No falla, no avisa: muestra los datos de una
clínica y esconde los de la otra, o al revés, sin nada en pantalla que lo delate.

**Esto no es hipotético y tiene fecha:** el dueño del producto va a estar en dos clínicas el día
que entre el segundo cliente. Ese día, esta función empieza a elegir tenant a dedo.

Ya mordió una versión más chica del mismo problema: hasta el 2026-08-05 la función **no filtraba
`is_active`**, y en producción devolvía la membresía **revocada** de un usuario que tenía una
activa y una dada de baja. La migración 00100 tapó ese caso; **el del `LIMIT 1` sigue abierto**.

Cuando se resuelva, el diseño tiene que contemplar que un usuario pertenezca a N clínicas y que
haya una **clínica activa por sesión** (selector + claim en el JWT, o función que devuelva un
conjunto y políticas con `IN`). No alcanza con cambiar el `ORDER BY`.

**Por qué está acá y no solo en un doc:** la recursión de RLS estaba documentada desde abril en
`docs/RLS_RECURSION_BACKLOG.md`, anticipaba textualmente el caso "Realtime subscription", y la
pisamos igual — porque nadie abre ese archivo antes de escribir una migración. Si esta deuda
también termina solo ahí, se repite.

### 🔴 Ningún cron filtra por estado de clínica — RESOLVER ANTES DE VENDER EL SEGUNDO CLIENTE

**Misma familia que el `LIMIT 1` de arriba, y revientan el mismo día.** Las dos son deudas que
hoy no duelen porque hay un solo cliente real: una elige tenant a dedo cuando hay dos, la otra
procesa a todos los tenants como si fueran uno. Las dos se cobran con el segundo cliente.
**Antes de vender, las dos.**

Ningún cron filtra las clínicas que procesa. `send-reminders`, `survey-post-consulta`,
`reactivacion`, `morning-report`, `weekly-report` y `post-consulta` hacen `.select(...)` sobre
`clinics` **sin una sola condición**: cada corrida barre las 20 filas de la tabla — clientes
reales, demos, pruebas y los seis duplicados de "Los Puchis".

Y no existe el campo con el que filtrar: **`clinics` no tiene `is_active`**. Lo más cercano es
`subscription_status` (default `'trial'`, nunca se lee para esto) y los flags de
`feature_config`.

Hoy no hace daño **por accidente**: casi ninguna de esas clínicas tiene credenciales de WhatsApp,
así que los envíos hacen `skip` antes de mandar nada. Es una barrera lateral, no una decisión —
el día que alguien cargue credenciales en una clínica de prueba, esa prueba le escribe a
pacientes reales.

Ya dejó rastro: "Centro Médico Bolívar" (demo) tenía credenciales válidas y un teléfono
imposible, y **cada cron intentaba el envío todos los días** y escribía un `whatsapp_send_failed`
por corrida — tapando con ruido el log que existe para detectar fallos de entrega reales. Se
desactivó a mano el 2026-08-18 (credenciales a NULL + `feature_config.agent/dashboard` en false),
que es un parche por fila, no una solución.

Cuando se resuelva: `clinics.is_active` (o `subscription_status` leído de verdad), el filtro en
los seis crons, y un default seguro — una clínica nueva **no** entra en los procesos automáticos
hasta que alguien la active. Y ojo con lo mismo de siempre: verde procesando cero no verifica
nada, así que al agregar el filtro hay que contar cuántas clínicas quedan dentro y confirmar que
son las que se esperaba.

### 🔴 El consentimiento de canal lo prendemos NOSOTROS por SQL — RESOLVER ANTES DE VENDER EL SEGUNDO CLIENTE

**Tercera de la misma familia**, junto con el `LIMIT 1` de `get_user_clinic_id` y los crons sin
filtro. Las tres son deudas de multi-tenant que hoy no duelen porque hay un solo cliente real, y
las tres se cobran el mismo día. **Antes de vender, las tres.**

`patients.proactive_contact_opt_in` es el gate de todo envío proactivo: sin él no sale
recordatorio, ni encuesta, ni reactivación. El 2026-08-18 se prendió para las 14.123 pacientes de
Algia — por orden de la clínica, pero ejecutado con un `UPDATE` a mano desde acá.

**Hoy la única prueba de que Algia lo pidió es una conversación de WhatsApp.** No hay fila, no hay
`audit_log`, no hay pantalla donde la clínica lo haya marcado. Para un dato de consentimiento
—Ley 1581, y estos son datos de salud— eso no alcanza: la trazabilidad tiene que estar en el
sistema, no en el chat de quien lo ejecutó.

Y en el mismo movimiento se cambió el **DEFAULT de la columna a `true`**, que es peor de lo que
parece: es a nivel de columna, así que **está decidiendo el consentimiento de pacientes de
clientes que todavía no existen**. La clínica que entre el mes que viene arranca con todo su
padrón en opt-in sin que nadie de esa clínica lo haya pedido.

Cuando se resuelva:

1. **Flag a nivel clínica** (`clinics.proactive_contact_enabled` o equivalente), **apagado por
   defecto** para clínicas nuevas.
2. **Lo prende la clínica desde su pantalla de notificaciones**, no nosotros por SQL. Al
   activarlo se aplica a sus pacientes.
3. **Queda en `audit_log`: quién lo activó y cuándo.** Ese registro es la prueba que hoy no
   existe.
4. **Revertir el `DEFAULT true` de `patients.proactive_contact_opt_in`** una vez que el flag
   exista. El default deja de tener sentido cuando la decisión es por clínica.
5. **Algia queda como está**, ya prendido — no se le vuelve a pedir nada.

Ojo con la distinción, que es fácil de mezclar: `proactive_contact_opt_in` es opt-in de **canal**
(por dónde se la contacta). `patients.data_consent_at` es el consentimiento de **tratamiento de
datos**, y es otro gate, con su propia Capa 0. Resolver uno no toca al otro.

### 🔴 La identidad de una paciente es su TELÉFONO, y en Colombia el teléfono se comparte

`patients` tiene **`UNIQUE (clinic_id, phone)`**. Eso convierte al teléfono en la
identidad de una paciente, y choca con cómo es el dato real: madres e hijas,
parejas y familias comparten celular.

**Lo que ya costó**, medido el 2026-08-18 al importar `isalud_clientes`:

- **433 teléfonos** de `isalud_clientes` están usados por **dos o más personas
  distintas**.
- De 1.577 documentos que faltaban en el padrón, **solo 719 se pudieron crear**.
  **858 rebotaron**: 461 porque su teléfono ya lo usaba otra ficha, y **397
  porque `phone = ''` —el "sin teléfono" del padrón— también entra en el UNIQUE
  y sólo admite UNA fila.**
- Quedaron **26 citas futuras sin recordatorio** por esto: la paciente existe en
  iSalud, tiene documento, y no se le puede crear ficha.

Dos casos concretos, para que se vea la forma del problema: Sharon Bustos no se
pudo crear porque su celular ya lo usa Natalia Elena Montoya; Diana María
Escobar, porque el suyo lo usa Yeimy Yohana Escobar Gallego — documentos
consecutivos, mismo apellido. Son familiares compartiendo teléfono, no
duplicados.

**Y no es sólo el import.** Una paciente nueva que escriba por WhatsApp desde un
celular ya registrado a nombre de un familiar tampoco puede tener ficha propia.

El arreglo es mover la identidad de *teléfono* a *documento*:
`UNIQUE (clinic_id, document_number)` y teléfono repetible. Riesgo real, y por
eso no se hizo sobre la marcha: **el webhook resuelve la paciente entrante por
teléfono** (`route.ts`, búsqueda por `phone`), así que hay que inventariar todo
el código que asume "un teléfono = una paciente" antes de tocar el constraint.
Con dos personas en el mismo celular, ¿de quién es el mensaje que llega? Esa
pregunta hay que contestarla en el diseño, no en la migración.

Va con las otras deudas de multi-tenant: no duele hasta que duele, y hoy ya
cuesta 858 fichas.

### Menor — dos citas el mismo día = dos recordatorios casi idénticos

El recordatorio se arma **por cita**, no por paciente. Quien tiene dos citas el
mismo día recibe dos mensajes que sólo se diferencian en la hora y el médico.

Ya pasó dos veces el 2026-08-18: Natalia Gaviria (7:00 con Jorge y 7:30 con
Juan Diego — dos consultas seguidas, legítimo) y Diana Milena Puerta (dos citas
a la MISMA hora con médicos distintos, que además es un dato imposible y hay
que revisar aparte).

Debería salir **un** mensaje con las dos citas listadas. Ojo al construirlo:
`reminder_24h_sent` es por fila de `appointments`, así que agrupar implica
marcar todas las citas del grupo cuando se manda el mensaje único — y que un
fallo de envío no deje la mitad marcada.

Prioridad baja: molesta, no engaña.

### Menor — el prompt narra automatismos del sistema

`system-prompt.ts` le cuenta al modelo cosas como *"si al cancelar hay alguien en lista de
espera, el sistema lo notifica automáticamente"*. Hoy es verdad y es contexto interno, no algo
que deba decirle a la paciente — pero es la misma forma del patrón 7: una afirmación sobre el
código que va a seguir escrita igual el día que el código cambie, y nadie va a acordarse de
venir a corregirla.

Prioridad baja: no miente hoy. Cuando se toque esa lógica, revisar también el prompt.

### Menor — la regla de condición pregunta sin mirar a quién

`consultation_type_rules` con `rule_type='patient_condition'` dispara su
pregunta a cualquiera que pida ese servicio. El 2026-08-18 el agente le
preguntó **"¿estás embarazada actualmente?" a un usuario hombre**.

No es un bug de la regla: la regla hace lo que dice. Falta que la pregunta
pueda condicionarse a algo del paciente —`patients.gender`, la edad— o que se
formule de modo que no dé por sentado quién está del otro lado. Hoy
`condition_config` no tiene dónde expresar eso.

Prioridad baja: no bloquea ni agenda mal, pero es de las cosas que la paciente
—o el paciente— cuenta después. Cuando se toque, ojo con el default seguro que
ya existe: **ante respuesta ambigua se deriva**, y eso no se cambia.

### SEC-001 — Credenciales en texto plano

`clinics.whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token` y
`sync_integrations.credentials` están **sin encriptar** en la DB. Quien acceda a la base obtiene
control del canal de WhatsApp de esa clínica: enviar mensajes haciéndose pasar por el
consultorio, leer el historial vía API de Meta, descargar los documentos que enviaron los
pacientes. Los tokens de Meta duran 60+ días, así que una copia exfiltrada tiene meses de
ventana.

Mitigación pendiente: encriptar con Vault/KMS, rotar una vez (invalida copias previas) y después
montar rotación periódica. Riesgo aceptado explícitamente para el piloto, con fecha comprometida
— no como "fast-follow" indefinido.

### Revelado de precios y convenios por el agente

El system prompt inyecta al contexto del modelo los precios y los **nombres de convenio** de los
tipos de consulta. Que el agente no los revele depende hoy de una regla escrita — y ya se observó
en producción que mencionó un convenio que el paciente nunca nombró. Hoy soltó un nombre; el
mismo camino puede soltar un precio.

No es confidencialidad legal: las tarifas por convenio son acuerdos comerciales entre la clínica
y la aseguradora, y además **no son lo que paga el paciente** (paga copago según su plan y la
autorización). Revelarlas confunde y rompe el contrato.

El fix correcto es de estructura, no de prompt (patrón 1): **filtrar el contexto** para que el
modelo reciba solo lo que necesita el flujo del paciente actual — sin precios de convenio y sin
nombres de convenio en el listado.

**PENDIENTE, y ahora con la medición que dice en qué orden hacerlo (2026-08-21).**
Se midieron 21 conversaciones reales preguntando "¿ustedes atienden X?":

| Lo que dijo la paciente | ¿Está cargado? | Qué contestó | ¿Llamó `check_eps_convenio`? |
|---|---|---|---|
| COLMEDICA | sí | 4/4 "sí, tenemos convenio" | 0/4 |
| **Nueva EPS** | **no** | **4/4 "Sí, tenemos convenio con Nueva EPS"** | 0/4 |
| Plan Zafiro / SOS / Asocoen | sí | 9/9 "sí" | 0/9 |
| un nombre inventado | no | 4/4 "no lo tengo registrado" + escaló | 4/4 |

**Sacar los nombres del prompt NO habría alcanzado, y eso es lo importante:**
Nueva EPS nunca estuvo en el catálogo del prompt y el modelo la afirmó igual, 4
de 4. No estaba leyendo el listado — estaba usando su conocimiento del mundo
("Nueva EPS existe en Colombia" → "la atendemos"). Por eso el arreglo que entró
primero fue el **guard 10**: si afirma o niega un convenio sin haber llamado la
tool, se le devuelve el turno para que la llame. Con el guard, los "sí" falsos
sobre Nueva EPS pasaron de 4/4 a 0/7.

Con el guard puesto, sacar los nombres del catálogo **sí** tiene sentido y queda
pendiente: reduce lo que el modelo puede repetir de memoria, y hace que el único
camino al dato sea la tool. Es un cambio aparte, con su propia medición — el
riesgo a vigilar es el inverso, que sin el listado el modelo pregunte el
convenio en flujos donde hoy no hace falta.

### El editor de reglas no deja agregar un convenio nuevo

La regla `requires_authorization` se configura marcando convenios de una lista, y esa lista sale
de los que ya existen como `eps_name` en algún tipo de consulta de la clínica. **No hay input de
texto libre.** Si una clínica exige autorización para un convenio con el que todavía no tiene
ningún servicio cargado, no puede configurarlo — y el paciente de ese convenio se agenda sin que
se le pida la autorización.

Cuando se construya: el convenio agregado se persiste dentro de `condition_config` de esa regla,
sin tocar `consultation_types`, y se valida contra la lista existente ignorando mayúsculas y
tildes para no crear un duplicado. El matcheo en runtime ya tolera variantes de escritura.

---

## 📏 CONVENCIONES DE CÓDIGO

```
TypeScript estricto. Sin `any`. Tipos para todo.
Archivos kebab-case · funciones camelCase · tipos PascalCase · DB snake_case.
Imports con alias @/.
Validar input con Zod. Filtrar SIEMPRE por clinic_id.
try/catch siempre. NUNCA exponer el error al paciente: mensaje genérico + salida a humano.
WhatsApp: máx 4096 chars. Templates para proactivos; reactivos sin template.
Zona horaria: America/Bogota SIEMPRE. UTC en DB, COT para mostrar. Cuidado con parseISO de
fechas sin hora — fijar la hora y el offset explícitos.
Comentarios en español. Nombres técnicos en inglés.
Todo lo que LEE una persona —paciente en WhatsApp o staff en el dashboard— va en
TUTEO colombiano ("puedes", "tienes", "escríbenos"). NUNCA voseo, NUNCA "usted".
Y todo lo que LEE EL MODELO también: notas de selfCorrection, instruction_for_llm,
message_for_patient. El registro lo fija el último texto que leyó, no el system
prompt — ver el caso del guard 10 en la sección de Colombia.
Commits en español: feat(agente): agregar reagendamiento
```

La lógica que se pueda escribir **pura** (sin DB ni red) se escribe pura y se testea con un
script en `scripts/`. Es la diferencia entre poder verificar algo en segundos y tener que montar
una conversación de WhatsApp completa.

---

## 🚀 COMANDOS

```bash
npm run dev            # localhost:3000
npm run build          # build de producción
npm run lint
npx tsc --noEmit       # typecheck
npx tsx scripts/<x>.ts # tests y diagnósticos puntuales
npx supabase db push   # migraciones
npx supabase gen types typescript --local > src/types/database.ts
```

**Deploy:** push a `main` y Vercel deploya solo. **Nunca `vercel deploy --prod` a mano** — el
alias del dominio queda anclado a ese deploy y los siguientes push quedan en el limbo mientras el
cliente sigue usando código viejo.

---

## 📝 NOTAS PARA CLAUDE CODE

1. **El usuario es nuevo en programación.** Explicá las decisiones y por qué, no solo el qué.
2. **Prioridad: que funcione > que sea perfecto**, pero sin transar los invariantes de arriba.
3. Ante dos opciones, la más simple.
4. Si agregás una dependencia, explicá por qué y si había alternativa más simple.
5. Escribí en el estilo del código que rodea lo que tocás.
6. **Nunca dejes un bucle de espera sin timeout.** Si algo externo no responde, reportalo.
7. **Antes de escribir en la DB de un cliente real: mostrá qué filas se van a tocar y esperá el
   OK.** Producción es producción aunque el cambio sea "obvio".
8. **No cambies números que el cliente mira** (reportes, conteos, métricas) sin confirmación
   explícita previa.
9. Cuando un cambio toque un invariante de la sección 🧠, decilo en el mensaje. Es la sección que
   protege lo que ya nos costó caro.

---

*Documento de producto. Contexto de clientes: `docs/CLIENTE_<NOMBRE>.md`.*
