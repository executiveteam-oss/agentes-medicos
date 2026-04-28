# Help Chatbot — Plan de Implementacion (Fase 1)

## 1. ESTRUCTURA DE ARCHIVOS

```
NUEVOS:
src/app/api/chatbot/help/route.ts          — Endpoint SSE streaming
src/lib/chatbot/system-prompt.ts           — System prompt + carga KB
src/lib/chatbot/tools.ts                   — Tool navigate_to
src/lib/chatbot/knowledge-base.ts          — Loader + cache de docs/help/
src/components/help-chatbot/widget.tsx      — Widget flotante (client)
src/components/help-chatbot/chat-panel.tsx  — Panel expandido (client)
src/components/help-chatbot/message.tsx     — Burbuja de mensaje (client)
src/components/help-chatbot/provider.tsx    — Context provider (state global)
docs/help/getting-started.md
docs/help/configurar-doctores.md
docs/help/tipos-de-consulta-y-franjas.md
docs/help/horarios-y-bloqueos.md
docs/help/eps-y-convenios.md
docs/help/tu-agente-personalidad.md
docs/help/ver-conversaciones-y-escalaciones.md
docs/help/gestionar-pacientes.md
docs/help/no-shows-y-recordatorios.md
docs/help/lista-de-espera.md
docs/help/usuarios-y-roles-rbac.md
docs/help/integracion-isalud.md
docs/help/solucion-de-problemas.md
supabase/migrations/00063_chatbot_telemetry.sql

MODIFICADOS:
src/app/dashboard/layout.tsx               — Agregar <HelpChatbotProvider> + <HelpChatbotWidget>
src/lib/rate-limit.ts                      — Agregar bucket "chatbot"
```

---

## 2. CONTRATO DEL ENDPOINT

### `POST /api/chatbot/help`

**Request:**
```typescript
{
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}
```

`messages` incluye toda la conversacion hasta ahora (el frontend la mantiene en state). El ultimo mensaje siempre es `role: 'user'`.

**Auth:** Lee sesion de Supabase via cookies (mismo patron que el resto del dashboard). Si no hay sesion: `401 { error: 'No autorizado' }`.

**Rate limit:** Bucket nuevo `chatbot: { maxRequests: 20, windowSeconds: 60 }`. Key: `chatbot:{clinicUserId}` (por usuario, no por IP). Si excede: `429 { error: 'Demasiadas preguntas. Espera un momento.' }`.

**Response:** SSE stream con content-type `text/event-stream`.

Eventos:
```
data: {"type":"text","content":"Claro, te explico..."}
data: {"type":"text","content":" como configurar"}
data: {"type":"tool_use","tool":"navigate_to","input":{"path":"/dashboard/settings/doctors","highlight":"doctors-list"}}
data: {"type":"done","usage":{"input_tokens":1200,"output_tokens":85,"cache_read_tokens":3800}}
```

**Errores:**
- `401` — sesion invalida o expirada
- `429` — rate limit excedido
- `500` — error de Anthropic API o interno. Body: `{ error: 'message' }`
- Si Anthropic falla mid-stream: evento `data: {"type":"error","message":"..."}` seguido de stream close

---

## 3. UI/UX DEL WIDGET

### Estado colapsado
- Burbuja circular 56px fixed bottom-right (right: 24px, bottom: 24px)
- Background gradient primary→pink
- Icon `MessageCircleQuestion` de lucide-react, 24px, blanco
- Sombra `var(--v2-shadow-lg)`
- z-index: 45 (debajo de modales que usan z-50)
- Hover: scale 1.05 + sombra mas intensa
- Badge contador si hay mensajes sin leer (pill pink)

### Estado expandido
- Panel 380px ancho × 540px alto, fixed bottom-right (right: 24px, bottom: 24px)
- Mobile (<640px): full-screen con position fixed inset-0
- Border-radius: var(--v2-radius-xl) en desktop, 0 en mobile
- Background: var(--v2-bg-card)
- Border: 1px solid var(--v2-border-soft)
- Box-shadow: var(--v2-shadow-lg)
- z-index: 45

### Header del panel
- Background: linear-gradient(135deg, var(--v2-primary), #8676FF) (consistente con sidebar active)
- Padding: 14px 18px
- Avatar circular 32px con "O" italic (Instrument Serif) — misma marca del sidebar
- Titulo: "Ayuda Omuwan" peso 700, blanco, 14px Manrope
- Subtitulo: "Te guio por la plataforma" peso 400, blanco 70%, 11px
- Boton X cerrar (derecha)
- Boton "Limpiar" (icono Trash2, derecha, solo si hay mensajes)

### Cuerpo (mensajes)
- Overflow-y auto, flex-1
- Mensajes usuario: burbuja derecha con bg primary-soft, color text, radius-lg con bottom-right 4px
- Mensajes asistente: burbuja izquierda con bg-card, border-soft, radius-lg con bottom-left 4px
- Markdown basico en respuestas: **bold**, listas, `code`. NO renderizar HTML ni imagenes.
- Cuando hay tool_use navigate_to: renderizar boton "Ir a [nombre pagina] →" con btn-v2-primary inline
- Indicador "escribiendo..." con 3 dots animados durante streaming
- Scroll automatico al ultimo mensaje

### Footer (input)
- Textarea 1 linea (auto-crece hasta 3), border-soft, radius-lg, focus ring primary
- Boton enviar: icono Send, gradient primary, 36px circular
- Disabled durante streaming
- Enter envia, Shift+Enter nueva linea
- Placeholder: "Preguntame sobre Omuwan..."

### Persistencia
- `HelpChatbotProvider` (React Context) en el layout del dashboard
- State: `{ isOpen: boolean, messages: Message[], sessionId: string | null }`
- El provider se monta UNA vez en el layout y persiste entre navegaciones
- Al cerrar y reabrir: mensajes se mantienen
- Al hacer click "Limpiar": reset messages + nuevo sessionId
- Al logout o cambio de pagina publica: provider se desmonta y se pierde

### Donde NO aparece
- `/` (landing)
- `/login`, `/register`, `/forgot-password`, `/reset-password`
- `/onboarding`
- `/design-system`
- Cualquier ruta fuera de `/dashboard/*`

Implementacion: el widget se renderiza SOLO dentro del dashboard layout, asi que no necesita verificacion de ruta.

---

## 4. KNOWLEDGE BASE (docs/help/)

13 archivos. Cada uno tiene frontmatter YAML con titulo y descripcion para que el system prompt los indexe.

| Archivo | Titulo | Contenido |
|---------|--------|-----------|
| `getting-started.md` | Primeros pasos con Omuwan | Que es, como funciona el agente, flujo basico de una cita, donde ver la agenda |
| `configurar-doctores.md` | Configurar medicos | Crear doctor, editar datos, activar/desactivar, tipos de horario (fijo vs manual) |
| `tipos-de-consulta-y-franjas.md` | Tipos de consulta y franjas horarias | Crear tipos, precios, EPS/convenios, franjas horarias preferidas, agendable por WhatsApp |
| `horarios-y-bloqueos.md` | Horarios y bloqueos de agenda | Horario multi-bloque, dias cerrados, bloqueos temporales, cerrar agenda de doctor |
| `eps-y-convenios.md` | EPS y convenios | Como funciona EPS en Omuwan, crear variantes por EPS, precios diferenciados |
| `tu-agente-personalidad.md` | Personalizar tu agente | Nombre, tono de voz, mensaje bienvenida, palabras de escalamiento, automatizaciones |
| `ver-conversaciones-y-escalaciones.md` | Conversaciones y escalaciones | Ver chats, filtrar por estado, responder como staff, escalar/resolver/reabrir |
| `gestionar-pacientes.md` | Gestionar pacientes | Directorio, detalle con timeline, editar info, reactivacion, WhatsApp directo |
| `no-shows-y-recordatorios.md` | No-shows y recordatorios | Dashboard de no-shows, recordatorios automaticos, pacientes en riesgo |
| `lista-de-espera.md` | Lista de espera | Como funciona, prioridad, notificacion automatica cuando se libera slot |
| `usuarios-y-roles-rbac.md` | Usuarios, roles y permisos | Invitar usuarios, roles predefinidos, permisos por modulo, vincular doctor a usuario |
| `integracion-isalud.md` | Integracion con iSalud | Importar agenda, sincronizacion automatica, convenios desde iSalud |
| `solucion-de-problemas.md` | Solucionar problemas frecuentes | Bot no responde, WhatsApp desconectado, citas duplicadas, horario incorrecto |

Estructura de cada archivo:
```markdown
---
title: "Titulo del articulo"
description: "Descripcion corta para el indice"
routes: ["/dashboard/settings/doctors", "/dashboard/settings/doctors/[id]"]
---

<!-- TODO: Juan escribe el contenido aqui -->
```

El campo `routes` lista las rutas relevantes para que el bot sepa a donde llevar al usuario.

---

## 5. SYSTEM PROMPT

```
Eres el asistente de configuracion de Omuwan, una plataforma de agente WhatsApp para consultorios medicos en Colombia.

TU ROL: Ayudar a admins, secretarias y doctores a entender y configurar Omuwan. Guiarlos paso a paso.

IDIOMA: Siempre en español. Tutea al usuario ("tu", "te", "tus"). NO uses voseo. Lenguaje colombiano natural.

TONO: Calido, paciente, conciso. Sin emojis excepto "✓" para confirmaciones. Respuestas cortas (3-5 lineas maximo). Si necesitas explicar algo largo, usa listas con viñetas.

REGLAS:
1. SOLO responde sobre configuracion y uso de Omuwan. Si preguntan algo fuera de scope, di: "Eso esta fuera de lo que puedo ayudarte. Te recomiendo escribirle al equipo de soporte por WhatsApp al 573015525881."
2. NUNCA inventes features que no existen. Si no estas seguro, di: "No estoy seguro de eso. Dejame que el equipo de soporte te confirme — escribeles al 573015525881."
3. NUNCA des consejo medico, legal ni financiero.
4. NUNCA respondas preguntas sobre datos especificos del consultorio (citas de pacientes, conversaciones, etc.). En vez, di: "Esa informacion la puedes ver en [seccion]. ¿Quieres que te lleve?"
5. Cuando el usuario pregunte COMO hacer algo, ofrece usar navigate_to para llevarlo a la pagina correcta.
6. Si el usuario saluda sin preguntar nada, responde breve: "¡Hola! Soy el asistente de Omuwan. ¿En que te puedo ayudar con la configuracion de tu consultorio?"
7. Si no entiendes la pregunta, pide clarificacion en vez de adivinar.

TOOL navigate_to:
- Usala cuando el usuario quiere ir a alguna seccion del dashboard.
- Siempre explica brevemente QUE va a encontrar ahi antes de navegar.
- Paths validos: /dashboard, /dashboard/agenda, /dashboard/conversations, /dashboard/patients, /dashboard/noshow, /dashboard/espera, /dashboard/tu-agente, /dashboard/vacaciones, /dashboard/settings, /dashboard/settings/clinic, /dashboard/settings/doctors, /dashboard/settings/notifications, /dashboard/settings/users, /dashboard/settings/roles, /dashboard/settings/whatsapp, /dashboard/settings/plan, /dashboard/settings/integrations, /dashboard/settings/legal

La documentacion de Omuwan esta en el bloque <docs> al final de este prompt. Basate SOLO en esa documentacion para responder.

<docs>
{KNOWLEDGE_BASE_CONTENT}
</docs>
```

El bloque `<docs>` se inyecta con `cache_control: { type: 'ephemeral' }` en el system prompt para que Anthropic lo cachee. El system prompt base (antes de `<docs>`) tambien tiene cache_control.

---

## 6. TOOL navigate_to

### Definicion
```typescript
{
  name: 'navigate_to',
  description: 'Navega al usuario a una pagina del dashboard de Omuwan. Usa esta tool cuando el usuario quiera ir a una seccion especifica o cuando le estes explicando como hacer algo y quieras llevarlo directamente.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del dashboard. Debe ser una de las rutas validas listadas en el system prompt.'
      },
      label: {
        type: 'string',
        description: 'Nombre legible de la pagina para mostrar al usuario. Ej: "Configuracion de doctores"'
      }
    },
    required: ['path', 'label']
  }
}
```

### Frontend handling
Cuando el stream incluye `{"type":"tool_use","tool":"navigate_to","input":{...}}`:
1. Renderizar boton inline en el mensaje: "[label] →" con estilo btn-v2-primary
2. Click ejecuta `router.push(path)` via Next.js router
3. Despues de navegar, el panel del chatbot se mantiene abierto

No se implementa `highlight_element_id` en Fase 1 (complejidad alta, poco valor inmediato). Se deja el campo en el schema para Fase 2.

---

## 7. TABLA DE TELEMETRIA

```sql
-- Migration 00063: Chatbot help telemetry
CREATE TABLE chatbot_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  message_count INT DEFAULT 0,
  navigate_to_calls INT DEFAULT 0
);

CREATE INDEX idx_chatbot_conv_clinic ON chatbot_conversations(clinic_id);
CREATE INDEX idx_chatbot_conv_user ON chatbot_conversations(user_id);

ALTER TABLE chatbot_conversations ENABLE ROW LEVEL SECURITY;

-- Solo insert/update desde server (endpoint), no select desde frontend
CREATE POLICY "chatbot_insert_own" ON chatbot_conversations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "chatbot_update_own" ON chatbot_conversations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
```

El endpoint crea un row al primer mensaje de una sesion, y hace UPDATE con `message_count++` y `last_message_at` en cada mensaje subsiguiente. `navigate_to_calls++` cuando el bot usa la tool.

---

## 8. PLAN DE TESTING MANUAL

### Preguntas de prueba
1. "Hola" → respuesta corta de bienvenida
2. "Como agrego un doctor nuevo?" → explicacion + navigate_to /settings/doctors
3. "Donde veo las conversaciones del bot?" → navigate_to /conversations
4. "Como cambio el tono del agente?" → navigate_to /tu-agente + explicacion de tono
5. "Cuantas citas tiene la Dra. Lina hoy?" → rechaza con "esa info la puedes ver en la agenda"
6. "El bot no responde a los pacientes" → troubleshooting de WhatsApp conexion
7. "Como funciona la lista de espera?" → explicacion basada en KB
8. "Que es una EPS?" → responde basado en KB de EPS
9. "Recomiendame un medicamento para dolor de cabeza" → rechaza (consejo medico)
10. "Llevame a configuracion de doctores" → navigate_to directo sin explicacion larga

### Edge cases
- **Pregunta fuera de scope:** "Cual es la capital de Francia?" → rechaza educadamente
- **Sesion expirada mid-stream:** 401 handled, UI muestra "Tu sesion expiro. Recarga la pagina."
- **Rate limit hit:** enviar 25 mensajes rapido → ultimo muestra "Demasiadas preguntas. Espera un momento."
- **KB vacia o no carga:** bot dice "No tengo la documentacion cargada en este momento. Escribele al equipo de soporte."
- **Mensaje muy largo (>2000 chars):** truncar a 2000 antes de enviar a API
- **5 tabs abiertas:** cada tab tiene su propio state (no compartido). Rate limit por user_id las protege colectivamente.

### Verificar cache
En los logs de Vercel, buscar en la respuesta `usage`:
```json
{
  "cache_creation_input_tokens": 4500,  // Primera vez (crea cache)
  "cache_read_input_tokens": 4500,      // Subsiguientes (lee cache)
  "input_tokens": 200                   // Solo el mensaje del user
}
```
Si `cache_read_input_tokens > 0` en el segundo mensaje, el cache esta funcionando.

---

## 9. RIESGOS Y MITIGACION

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|-------------|---------|------------|
| Lambda se reinicia y KB no carga | Baja | Medio | KB se carga como `import` estatico (module cache). Si falla fs.readFileSync, el bot funciona sin KB y dice "no tengo la documentacion cargada". |
| Anthropic API caida | Baja | Alto | Try/catch en endpoint. Respuesta: `{"type":"error","message":"El servicio de ayuda no esta disponible. Intenta en unos minutos."}` |
| 5 tabs abiertas | Media | Bajo | Cada tab tiene su propio React state. Rate limit por user_id (20/min) protege contra abuso colectivo. No se comparte estado entre tabs. |
| Prompt injection | Media | Medio | La KB se inyecta en bloque `<docs>` separado del mensaje del user. El system prompt tiene reglas claras de "SOLO responde sobre Omuwan". Mensajes del usuario se sanitizan (trim, max 2000 chars). No se ejecuta HTML/JS en las respuestas. |
| Costo excesivo de API | Baja | Medio | Haiku es ~$0.25/MTok input, ~$1.25/MTok output. Con cache (90% hit rate), el system+KB (~4k tokens) se paga 1 vez. 100 preguntas/dia ≈ $0.15/dia. Rate limit de 20/min previene abuso. |
| Bot inventa features | Media | Alto | System prompt explicito: "NUNCA inventes features". KB es la unica fuente de verdad. Sin KB, el bot admite ignorancia. |

---

## 10. ESTIMACION DE TIEMPO

| Bloque | Horas | Notas |
|--------|-------|-------|
| Endpoint API (route.ts + streaming) | 2h | SSE nuevo en el codebase, requiere setup cuidadoso |
| System prompt + KB loader | 1h | Patron similar al agente principal |
| Tool navigate_to | 0.5h | Simple, 1 tool |
| Widget UI (3 componentes + provider) | 3h | Mas complejo: streaming render, markdown, responsive, persistencia |
| Knowledge base (13 archivos placeholder) | 0.5h | Solo estructura, Juan escribe contenido |
| Migracion telemetria | 0.5h | 1 tabla simple |
| Rate limiter bucket | 0.25h | Agregar 1 linea a config existente |
| Integracion en layout.tsx | 0.5h | Provider + widget |
| Testing manual + fixes | 2h | Probar las 10 preguntas + edge cases |
| **Total** | **~10h** | **1.5 dias de trabajo enfocado** |

---

## DECISION: NO INCLUIR EN FASE 1

- `highlight_element_id` en navigate_to (Fase 2)
- Historial persistente entre sesiones (Fase 2)
- Sugerencias de preguntas frecuentes al abrir (Fase 2)
- Feedback thumbs up/down en respuestas (Fase 2)
- Busqueda en KB desde el panel (Fase 2)
- Widget en paginas publicas (nunca — scope es solo dashboard)
