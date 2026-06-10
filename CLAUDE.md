# CLAUDE.md — Agente IA WhatsApp para Clínicas (Colombia)

> **Estado:** Ideación → MVP | **Mercado:** Colombia 🇨🇴 | **Cliente:** Consultorios 1-3 médicos | **Modelo:** Setup + mensualidad

---

## 📌 Resumen

SaaS B2B: agente de IA por WhatsApp para consultorios médicos pequeños en Colombia. Reemplaza tareas de secretaria: agenda citas, responde FAQ, envía recordatorios, reduce no-shows. Cobro: setup inicial + suscripción mensual.

**Propuesta de valor:** "Tu consultorio atendiendo 24/7 por WhatsApp, sin contratar más personal."

### Nombres sugeridos
- **Sekre** — referencia a "secretaria", memorable
- **AgenDA Med** — Agente + Agenda + Med
- **Clio Salud** — profesional y humano
- **MediBot.co** — directo, dominio .co

---

## 🎯 Problema

1. Secretaria/doctor pasan horas respondiendo WhatsApp para agendar citas
2. No-shows del 20-35% = dinero perdido
3. Nadie responde fuera de horario → se pierden pacientes
4. "¿Cuánto cuesta?", "¿Dónde queda?" se responde 30+ veces/día
5. Gestión en Excel/papel/iSalud sin automatización

---

## 🏗️ Stack Tecnológico

```
FRONTEND + BACKEND    →  Next.js 14+ (App Router) + TypeScript → Vercel
BASE DE DATOS         →  Supabase (PostgreSQL + Auth + Realtime)
MENSAJERÍA            →  WhatsApp Business Cloud API (Meta)
IA                    →  Claude API (Anthropic) — claude-sonnet
CRON JOBS             →  Vercel Cron / Supabase Edge Functions
PAGOS                 →  Wompi (PSE, Nequi, tarjetas en COP)
UI                    →  Tailwind CSS + shadcn/ui
VALIDACIÓN            →  Zod
FECHAS                →  date-fns + date-fns-tz
```

**¿Por qué?** Un solo proyecto fullstack (Next.js), DB managed sin config (Supabase), deploy sin servidores (Vercel), tiers gratis generosos para MVP. Claude es el mejor modelo para conversaciones empáticas en español.

---

## 📁 Estructura del Proyecto

```
src/
├── app/
│   ├── (auth)/login/ & register/
│   ├── (dashboard)/
│   │   ├── appointments/        # Ver/gestionar citas
│   │   ├── patients/            # Directorio pacientes
│   │   ├── settings/            # Config agente, horarios, precios, FAQ
│   │   ├── analytics/           # Métricas no-show, citas
│   │   └── conversations/       # Ver conversaciones del agente
│   ├── api/
│   │   ├── webhooks/whatsapp/   # Recibe mensajes de WhatsApp
│   │   ├── appointments/        # CRUD citas
│   │   ├── patients/            # CRUD pacientes
│   │   └── cron/                # Recordatorios programados
│   └── page.tsx                 # Landing pública
├── agents/
│   ├── appointment-agent.ts     # Agente principal
│   ├── faq-agent.ts             # Respuestas automáticas
│   ├── reminder-agent.ts        # Lógica recordatorios
│   └── prompts/                 # System prompts por agente
├── lib/
│   ├── supabase/                # client.ts, server.ts, admin.ts
│   ├── whatsapp/                # client.ts, templates.ts, webhook-handler.ts
│   ├── anthropic/               # client.ts, tools.ts
│   ├── payments/wompi.ts
│   ├── validators/              # Schemas Zod
│   └── utils.ts
├── components/
│   ├── ui/                      # shadcn/ui base
│   ├── dashboard/
│   └── appointments/
├── hooks/
├── types/                       # database.ts, whatsapp.ts, appointments.ts
└── styles/
supabase/
├── migrations/                  # SQL migrations
├── seed.sql
└── functions/send-reminders/
```

---

## 🗄️ Base de Datos (Supabase/PostgreSQL)

```sql
-- CLÍNICAS (tenants principales)
CREATE TABLE clinics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    whatsapp_phone_id TEXT,
    whatsapp_token TEXT,                    -- ENCRIPTADO
    address TEXT,
    city TEXT DEFAULT 'Pereira',
    department TEXT DEFAULT 'Risaralda',
    specialty TEXT,
    consultation_price INTEGER,             -- COP sin decimales
    consultation_duration_minutes INTEGER DEFAULT 30,
    working_hours JSONB DEFAULT '{
        "monday":{"start":"08:00","end":"18:00","active":true},
        "tuesday":{"start":"08:00","end":"18:00","active":true},
        "wednesday":{"start":"08:00","end":"18:00","active":true},
        "thursday":{"start":"08:00","end":"18:00","active":true},
        "friday":{"start":"08:00","end":"18:00","active":true},
        "saturday":{"start":"08:00","end":"13:00","active":true},
        "sunday":{"start":"08:00","end":"12:00","active":false}
    }',
    faq JSONB DEFAULT '[]',
    agent_name TEXT DEFAULT 'Asistente',
    agent_personality TEXT DEFAULT 'profesional y amable',
    welcome_message TEXT,
    subscription_status TEXT DEFAULT 'trial',
    subscription_plan TEXT DEFAULT 'basic',
    trial_ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DOCTORES
CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    specialty TEXT,
    phone TEXT,
    email TEXT,
    is_active BOOLEAN DEFAULT true,
    working_hours JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PACIENTES
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,                     -- +57 3XX XXX XXXX
    email TEXT,
    document_type TEXT DEFAULT 'CC',         -- CC, TI, CE, PP
    document_number TEXT,
    date_of_birth DATE,
    eps TEXT,
    notes TEXT,
    no_show_count INTEGER DEFAULT 0,
    total_appointments INTEGER DEFAULT 0,
    data_consent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(clinic_id, phone)
);

-- CITAS
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES doctors(id),
    patient_id UUID REFERENCES patients(id),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'confirmed',         -- confirmed, cancelled, completed, no_show, rescheduled
    reason TEXT,
    source TEXT DEFAULT 'whatsapp_agent',    -- whatsapp_agent, manual, dashboard
    notes TEXT,
    reminder_24h_sent BOOLEAN DEFAULT false,
    reminder_2h_sent BOOLEAN DEFAULT false,
    confirmation_received BOOLEAN DEFAULT false,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CONVERSACIONES
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id),
    whatsapp_phone TEXT NOT NULL,
    status TEXT DEFAULT 'active',            -- active, resolved, escalated
    escalated_to TEXT,
    escalated_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MENSAJES
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,                      -- patient, agent, staff
    content TEXT NOT NULL,
    whatsapp_message_id TEXT,
    message_type TEXT DEFAULT 'text',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RECORDATORIOS
CREATE TABLE reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                      -- 24h, 2h
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',           -- pending, sent, failed
    response TEXT,                           -- confirmed, rescheduled, cancelled, no_response
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AUDITORÍA
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id),
    action TEXT NOT NULL,
    actor_type TEXT NOT NULL,                -- agent, staff, system, patient
    actor_id TEXT,
    target_type TEXT,
    target_id UUID,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ÍNDICES
CREATE INDEX idx_appointments_clinic_date ON appointments(clinic_id, starts_at);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_patients_clinic_phone ON patients(clinic_id, phone);
CREATE INDEX idx_conversations_clinic ON conversations(clinic_id, status);
CREATE INDEX idx_reminders_pending ON reminders(status, scheduled_for);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- RLS (cada clínica solo ve sus datos)
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
```

---

## 🤖 Agente de WhatsApp

### Flujo

```
Paciente escribe → Webhook recibe → Identificar clínica → Buscar/crear paciente
→ Cargar contexto (conversación + citas + config) → Claude API (prompt + tools)
→ Ejecutar tool si aplica → Enviar respuesta por WhatsApp → Guardar en DB
```

### System Prompt (base)

```
Eres el asistente virtual de {clinic.name}. Tu nombre es {clinic.agent_name}.

ROL: Secretaria virtual. Agendas citas, respondes FAQ, confirmas/cancelas citas.

INFO DEL CONSULTORIO:
- Especialidad: {specialty} | Dirección: {address}, {city}
- Precio: ${consultation_price} COP | Duración: {duration} min
- Horarios: {working_hours}
- Doctor: {doctor.name} — {doctor.specialty}
- FAQ: {clinic.faq}

REGLAS INQUEBRANTABLES:
1. NUNCA des diagnósticos ni recomiendes medicamentos
2. NUNCA compartas info de un paciente con otro
3. NUNCA inventes info (precios, horarios, servicios)
4. Emergencia → "Llama al 123 o ve a urgencias AHORA"
5. Paciente pide humano (1 intento de retención) → escala
6. No sabes algo → "Lo consulto con el consultorio"
7. SIEMPRE confirma datos antes de agendar (fecha, hora, nombre)
8. Hora colombiana: 2:00 PM (no 14:00). Dinero: $80.000 COP
9. Primer mensaje a paciente nuevo → aviso de privacidad

TONO: {agent_personality}. Tutear. Lenguaje sencillo. Breve (3-4 líneas máx).
Emojis con moderación. NO markdown. NO "Estimado usuario".
SÍ: "¡Hola!", "¡Listo!", "¡Perfecto!", "Con gusto"

CONFIRMACIÓN DE CITA:
✅ Cita agendada:
📅 [martes 15 de marzo]
🕐 [2:00 PM]
👨‍⚕️ [Doctor]
📍 [Dirección]

ZONA HORARIA: America/Bogota (UTC-5). Fecha actual: {now}
```

### Tools (Function Calling)

| Tool | Descripción | Params requeridos |
|---|---|---|
| `check_availability` | Horarios disponibles | doctor_id, preferred_date?, preferred_time? |
| `create_appointment` | Agendar cita (solo tras confirmación del paciente) | doctor_id, patient_name, patient_phone, starts_at |
| `get_patient_appointments` | Citas futuras del paciente | patient_phone |
| `cancel_appointment` | Cancelar cita | appointment_id, reason |
| `reschedule_appointment` | Reagendar cita | appointment_id, new_starts_at |
| `escalate_to_human` | Escalar a humano | reason, urgency (low/medium/high/emergency) |

### Config Claude API
- Modelo: `claude-sonnet-4-20250514`
- Max tokens: 1024 (respuestas cortas para WhatsApp)
- Temperature: 0.3 (consistencia)
- Siempre incluir tools en cada llamada

---

## 🗺️ Roadmap

### Fase 0 — Setup (Semana 1-2)
- [ ] Next.js + TS + Tailwind + shadcn/ui
- [ ] Supabase: proyecto, tablas, auth, RLS
- [ ] WhatsApp Business API (Meta Business Manager)
- [ ] API key Claude (Anthropic)
- [ ] Git repo + .env.example + deploy Vercel

### Fase 1 — MVP: Agente + Citas (Semana 3-6)
- [ ] Webhook WhatsApp funcionando
- [ ] Claude API + system prompt + tools
- [ ] check_availability, create_appointment, cancel_appointment
- [ ] FAQ automáticas (horarios, precios, ubicación)
- [ ] Dashboard mínimo: citas del día
- [ ] Registro auto de pacientes nuevos
- [ ] Aviso de privacidad en primer contacto
- [ ] **🎯 1 clínica piloto en producción**

### Fase 2 — Anti No-Show (Semana 7-9)
- [ ] Recordatorio 24h antes (WhatsApp template)
- [ ] Recordatorio 2h antes con confirmar/cancelar
- [ ] Reagendamiento desde recordatorio
- [ ] Cron job envío recordatorios
- [ ] Marcado automático de no-shows

### Fase 3 — Dashboard Completo (Semana 10-13)
- [ ] Calendario visual (día/semana)
- [ ] Gestión horarios doctor (bloquear fechas, vacaciones)
- [ ] Config FAQ, nombre y tono del agente
- [ ] Directorio pacientes + historial
- [ ] Ver/responder conversaciones (takeover humano)
- [ ] Notificaciones al staff
- [ ] Onboarding guiado nuevas clínicas

### Fase 4 — Monetización (Semana 14-16)
- [ ] Wompi (PSE, Nequi, tarjetas COP)
- [ ] Planes Basic/Pro + trial 14 días
- [ ] Landing + pricing
- [ ] Panel admin interno

### Fase 5 — Escalar (Mes 5+)
- [ ] SEO Colombia, múltiples doctores, export CSV (iSalud)
- [ ] Agente de voz, telemedicina, app móvil

---

## 🔒 Seguridad — Ley 1581/2012 (Colombia)

**REGLAS NO NEGOCIABLES:**
1. Consentimiento obligatorio antes de interactuar (aviso de privacidad en primer mensaje)
2. Datos de salud = dato SENSIBLE → consentimiento explícito + seguridad reforzada
3. Derechos ARCO: paciente puede pedir acceso, rectificación, cancelación, oposición
4. Registrar bases de datos en RNBD (Superintendencia de Industria y Comercio)
5. Variables sensibles SOLO en .env (nunca en código)
6. Tokens WhatsApp encriptados en DB
7. HTTPS obligatorio
8. Supabase RLS activo siempre (multi-tenant)
9. Audit log para acciones críticas
10. Sanitizar input del paciente antes del LLM
11. Rate limiting en webhooks/API — Upstash Redis en produccion (ver docs/RATE_LIMITING.md)
12. No loggear datos sensibles (teléfonos completos, documentos)

---

## 🆘 Emergencias y Escalamiento

**Emergencia médica** → "⚠️ Llama al 123 o ve a urgencias AHORA" + notificar staff
**Ideación suicida** → Empatía + Línea 106 (Colombia) + escalar urgency:emergency
**Pide humano** → 1 intento de retención → escalar sin resistencia

---

## 💰 Precios Sugeridos

| | Basic | Pro |
|---|---|---|
| Setup (único) | $200.000 COP | $400.000 COP |
| Mensualidad | $150.000 COP | $300.000 COP |
| Doctores | 1 | Hasta 3 |
| Conversaciones/mes | 500 | 2.000 |
| Recordatorios | ✅ | ✅ |
| FAQ personalizadas | 10 | Ilimitadas |
| Dashboard | Básico | Completo + analytics |

**Costo operativo por clínica:** ~$10-50 USD/mes → margen saludable.

---

## 🔄 Convivencia con iSalud

**MVP:** Agenda propia en Supabase. Sync manual. Export CSV desde dashboard.
**Futuro:** Investigar API de iSalud o posicionarse como reemplazo para consultorios pequeños.

---

## ⏳ MIGRACIÓN ALGIA — código de un solo uso, NO es feature del producto Omuwan

**Decisión de alcance (2026-06-10)**: TODO el código que toca iSalud — sync de citas, importador de convenios, parseo de aseguradora, derivación consulta-convenio, derivación de horarios (descartada) — es **infraestructura de migración de Algia**, no feature del producto Omuwan.

**Razón**: Algia es el ÚNICO cliente que migra de iSalud. Futuros clientes configuran horarios, convenios y tipos de consulta DIRECTAMENTE en Omuwan desde cero, sin importador. Generalizar este código para "cualquier clínica con iSalud" sería esfuerzo desperdiciado.

**Implicaciones para sesiones futuras**:

1. **NO generalizar.** El código puede ser Algia-specific. Hardcodear los 26 convenios reales de Algia uno por uno está OK. Lo que importa es que **los datos de Algia queden bien**, no que el método sirva para otros.

2. **NO reusar para otro cliente.** Si en el futuro otro cliente quiere migrar desde iSalud, **diseñá un importador nuevo desde cero** con lo aprendido. El código de Algia no es plantilla.

3. **Tiene fecha de caducidad.** Cuando Algia opere 100% en Omuwan (sync cortado, agenda no se duplica con iSalud), este código se puede borrar entero. No tiene valor histórico que justifique mantenerlo.

4. **NO tratarlo como deuda técnica a refactorizar.** El código puede ser feo, hardcodeado, single-purpose. Eso es FEATURE, no bug — no inviertan tiempo en limpiarlo "para hacerlo bonito".

5. **La cautela sobre datos NO se relaja por ser de un solo uso.** Algia es el único cliente real, no hay donde practicar. Cualquier escritura a la DB de producción de Algia es producción real.

**Archivos en esta categoría (migración Algia, un solo uso)**:

| Archivo | Rol |
|---|---|
| `src/lib/isalud/consulta-convenio-derivation.ts` | Lógica pura — derivar combinaciones procedimiento×convenio desde citas |
| `src/lib/isalud/working-hours-derivation.ts` | Lógica pura — derivación de horarios (DESCARTADA, queda como referencia) |
| `src/lib/isalud/convenios-agent.ts` | Scrape Playwright del Manual Tarifario |
| `src/app/actions/isalud-consulta-convenio.ts` | Server actions: getSuggestionsForDoctor + confirmSuggestionsForDoctor |
| `src/app/actions/isalud-convenios.ts` | Server actions del flujo viejo product-first |
| `src/components/dashboard/doctors/types-import-panel.tsx` | UI doctor-first |
| `scripts/import-isalud-working-hours.ts` | Diagnóstico de horarios (descartado, queda como herramienta) |
| `scripts/test-consulta-convenio-derivation.ts` | Tests módulo derivación (38) |
| `scripts/test-working-hours-derivation.ts` | Tests módulo horarios descartado (29) |
| `scripts/dryrun-consulta-convenio-suggestions.ts` | Dry-run del feature contra Algia |

**Archivos del SYNC PRODUCTIVO que también son Algia-specific PERO siguen activos hoy** (corren por cron cada 30 min mientras dure la transición):

| Archivo | Estado |
|---|---|
| `src/lib/isalud/adapter.ts` | ACTIVO (Playwright login + scrape de admisiones) |
| `src/lib/isalud/sync-agent.ts` | ACTIVO (cron sync de citas para evitar doble-agendamiento) |
| `src/app/api/sync/isalud/route.ts` | ACTIVO (cron endpoint) |

Cuando Algia corte iSalud para agenda, **estos 3 también se apagan y se borran**.

**Cómo distinguir si algo es migración Algia vs feature productivo**:
- Si vive en `src/lib/isalud/` → migración Algia
- Si tiene `isalud` en el nombre del archivo → migración Algia
- Si menciona conceptos de iSalud (admisión, profesional, disponibilidad, convenio importado) → migración Algia
- Si es del producto Omuwan (citas, doctores, consultation_types como modelo, agente WhatsApp, dashboard) → NO migración, es feature productivo

---

## 🧪 Tests Críticos

| Escenario | Esperado |
|---|---|
| Agenda horario disponible | ✅ Cita + confirmación |
| Horario ocupado | Ofrece alternativas |
| Domingo (cerrado) | Informa horarios |
| Cancela cita | ✅ Cancelada + ofrece reagendar |
| Emergencia | "Llama al 123" |
| Pregunta precio | Precio correcto en COP |
| Escribe 11 PM | Responde (24/7) |
| Pide humano | Escala tras 1 intento |
| Audio/imagen | "Solo manejo texto por ahora" |
| 2 pacientes misma hora | Solo 1 lo logra |

---

## 📏 Convenciones de Código

```
TYPESCRIPT estricto. No `any`. Tipos para todo.
Archivos: kebab-case. Funciones: camelCase. Tipos: PascalCase. DB: snake_case.
Imports: @/ aliases.
Errores: try/catch siempre. NUNCA exponer al paciente. Mensaje genérico + "escribe 'hablar con humano'".
Validar input con Zod. Filtrar SIEMPRE por clinic_id.
WhatsApp: máx 4096 chars. Templates para proactivos, reactivos sin template.
Commits en español: feat(agente): agregar reagendamiento
Dinero: $150.000 COP (punto como separador miles, sin decimales).
Teléfono: almacenar +57, mostrar 3XX XXX XXXX.
Zona horaria: SIEMPRE America/Bogota. UTC en DB, COT para mostrar.
```

---

## 🌐 Variables de Entorno

```bash
# .env.example
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
WHATSAPP_VERIFY_TOKEN=mi-token-secreto
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321
WOMPI_PUBLIC_KEY=pub_test_...
WOMPI_PRIVATE_KEY=prv_test_...
WOMPI_EVENTS_SECRET=test_events_...
WOMPI_ENVIRONMENT=sandbox
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
CRON_SECRET=secreto-cron
```

---

## 🚀 Comandos

```bash
npm run dev          # localhost:3000
npm run build        # Build producción
npm run lint         # Linter
npm run test         # Tests
npx supabase start   # DB local
npx supabase db push # Migraciones
npx supabase gen types typescript --local > src/types/database.ts
npm run seed         # Datos demo
```

---

## 📞 WhatsApp Templates (requieren aprobación Meta)

```
RECORDATORIO 24H (appointment_reminder_24h, UTILITY):
"Hola {{1}}, te recordamos tu cita mañana {{2}} a las {{3}} en {{4}}.
¿Confirmas? ✅ Sí | ❌ No puedo | 📅 Reagendar"

RECORDATORIO 2H (appointment_reminder_2h, UTILITY):
"{{1}}, tu cita es en 2 horas ({{2}}). 📍 {{3}}. Te esperamos."

CITA CONFIRMADA (appointment_confirmed, UTILITY):
"✅ Cita agendada: 📅 {{1}} 🕐 {{2}} 👨‍⚕️ {{3}} 📍 {{4}}.
Si necesitas cambiar algo, escríbenos."
```

---

## 📝 Notas para Claude Code

```
1. SOY NUEVO EN PROGRAMACIÓN. Explica decisiones. Sugiere mejores prácticas.
2. COLOMBIA: COP sin decimales ($150.000), +57 cel, CC/TI/CE, EPS,
   America/Bogota UTC-5, DD/MM/YYYY, 12h AM/PM.
3. PRIORIDAD: Que funcione > que sea perfecto. MVP funcional primero.
4. Cada archivo nuevo debe seguir la estructura de este CLAUDE.md.
5. Si agregas dependencia, explica POR QUÉ y si hay alternativa más simple.
6. WhatsApp = mensajes CORTOS y NATURALES. Nada de "Estimado usuario".
7. Comentarios y UI en ESPAÑOL. Nombres técnicos en inglés.
8. Ante la duda entre dos opciones, elige la más SIMPLE.
9. SIEMPRE verificar que RLS esté activo y filtrar por clinic_id.
10. Zona horaria: America/Bogota SIEMPRE. Cuidado con UTC vs COT.
```

---

## 🔄 iSalud Sync Agent (14 Abril 2026)

### Qué se construyó

**Archivos principales:**
- `src/lib/isalud/adapter.ts` — Playwright headless con login HTTP + cookie injection
- `src/lib/isalud/sync-agent.ts` — importISalud(), ingestISaludData(), syncAllISaludIntegrations()
- `src/app/api/sync/isalud/route.ts` — GET (cron) + POST (import/force_sync/test)
- `src/components/dashboard/isalud-sync-button.tsx` — Botón "Importar agenda desde iSalud" en Dashboard
- `supabase/migrations/00047_isalud_sync.sql` — Tablas sync_integrations + doctor_external_mappings

**Tablas nuevas:**
- `sync_integrations` — credentials JSONB, sync_status, last_synced_at, UNIQUE(clinic_id, provider)
- `doctor_external_mappings` — mapeo profesional iSalud → doctor Omuwan, UNIQUE(clinic_id, provider, external_name)
- `appointments` columnas nuevas: external_source, external_data, synced_at

### Login iSalud (iSalud 24.02)

- URL raíz: `https://{subdomain}.isalud.co/`
- Form action: `/autenticacion/login`
- Campos: `login[Usuario]`, `login[Clave]`, `login[_csrf_token]`
- Login vía HTTP fetch (no Playwright) → extrae CSRF + cookies → POST form-urlencoded
- Cookies de sesión inyectadas en Playwright context para scraping de datos

### Scraping

- `/disponibilidad` — Playwright con "Cargar todo" toggle + DataTables max registros
- `/admision` — Datepicker jQuery (`#admision-date`, type=text, readonly)
  - Fecha se setea via `page.evaluate()` → `el.value = fecha` + jQuery `.datepicker('setDate')` + triggers
  - Columnas: 0=Id, 1=CC, 2=Nombre, 3=Procedimiento, 4=Aseguradora, 5=Profesional, 6=Ubicación, 7=HoraInicial, 8=Fase, 14=Fecha, 15=HoraFinal
- Appointments guardados con `status='blocked_external'`, `source='isalud'`
- `external_his_id` formato: `isalud-{id}-{fecha}`

### Datos confirmados de Algia

- URL: `https://algia.isalud.co/`
- 9 médicos importados dinámicamente con `working_hours` default (L-V 08:00-18:00, S 08:00-13:00)
- 313 citas bloqueadas en 60 días
- Cron cada 30 minutos: `/api/sync/isalud` en vercel.json
- `@sparticuz/chromium` + `playwright-core` en Vercel Pro (250MB)
- Binary fallback: descarga de GitHub Releases si local no existe

### Agente WhatsApp — integración

- `check_availability` en `src/agents/tools/executor.ts`:
  ```
  .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
  ```
  Slots de iSalud NO aparecen como disponibles para el agente.

### Calendario — integración

- `src/app/dashboard/page.tsx`: query incluye `blocked_external`
- `src/components/dashboard/calendar-view.tsx`: color morado para `blocked_external`, label "iSalud"
- Nombre del paciente: `apt.reason` (sin patient_id)

### Deuda técnica pendiente

1. **Orphan cleanup DESACTIVADO** — reactivar cuando multi-day scraping esté confirmado. El cleanup cancelaba todas las citas porque solo el día actual matcheaba
2. **Credenciales en texto plano** — `sync_integrations.credentials` JSONB sin encriptar (SEC-001)
3. **Horarios de médicos** — default L-V 08:00-18:00 para todos. Admin debe configurar horarios reales manualmente
4. **Datepicker /admision** — no confirmado que el cambio de fecha funciona para todos los días (puede devolver solo citas de hoy)
5. **Pacientes** — iSalud tiene nombre + CC pero no WhatsApp. No se crean registros en tabla patients
6. **Duración de citas** — usa hora_final real de col[15] cuando disponible, fallback +30min
7. ~~**Falso positivo del auth check en adapter.ts:151-156**~~ — **RESUELTO el 9 jun 2026**. Se reemplazó el login HTTP por login Playwright nativo (`loginAndInjectCookies` en `src/lib/isalud/adapter.ts`). El nuevo flujo valida éxito/fallo desde el DOM (URL != root Y form de login ausente), eliminando la ambigüedad del 302→/. Helpers `extractAllSetCookies` + `ParsedCookie` eliminados. Histórico del bug en `docs/AUDIT_ISALUD_SYNC_2026_06_08.md` sección "Bug auth check".
8. **`waitForTimeout(1500)` fijo post-submit en `loginAndInjectCookies`** — reemplazar a futuro por `waitForSelector` de un elemento de página interna (ej. nav del dashboard, link de logout, header de `/inicio`). Tiempo fijo genera falsos fallos si iSalud tarda más en redirigir; espera por condición es robusta. Mismo aplica al `waitForTimeout(2000)` post-`/disponibilidad`. Riesgo bajo hoy porque iSalud es predecible, pero conviene endurecerlo cuando agreguemos más clínicas con latencia variable

### ⚠️ Integraciones sandbox iSalud — NO REACTIVAR (anotado 2026-06-10)

Hay **2 filas de `sync_integrations` con `provider='isalud'`** que **NO son clientes productivos** y deben permanecer en `sync_status='disabled'` indefinidamente:

| Integración | clinic_id | Subdomain | Por qué NO reactivar |
|---|---|---|---|
| **LondoMEdical (legacy)** | `eb1ab762-7265-40cc-bf6e-ea7d49c9c9af` | `algia` ← MISMO subdomain que el cliente REAL Algia | User `amfranco` con clave inválida (login devuelve "Clave incorrecta"). Si se reactiva, **golpea el iSalud REAL del cliente Algia cada 30 min con logins fallidos** → riesgo de lockout de la cuenta `amfranco` + ruido para el cliente. |
| **demo** | `a1b2c3d4-0000-0000-0000-000000000001` | `demo` | `demo.isalud.co` **no resuelve** (NXDOMAIN). No es un iSalud productivo. Mantener solo para testing local. |

**Razones para conservarlas y no borrarlas**:
- Permiten testear el sync agent (con `subdomain` mockeado) sin tocar la integración real de Algia
- Sirven para validar que el filtro `.neq('sync_status', 'disabled')` del cron sigue funcionando — cada vez que un cron tick devuelve `synced=0`, lo confirmamos

**Salvaguardas activas**:
- Ambas tienen `sync_error` con prefijo `'SANDBOX — DO NOT ENABLE'` + explicación específica
- El cron de Vercel (`syncAllISaludIntegrations`) las excluye por la cláusula `.neq('sync_status', 'disabled')`
- Si en alguna sesión futura aparece la idea de "reactivar todas las iSalud disabled de golpe" — **STOP, leer este bloque**

**Si necesitás un sandbox nuevo de verdad**: crear una clínica de pruebas con su propio `clinic_id` + un `subdomain` que NO sea `algia` (para no confundir con productivo) — no reutilizar estas 2.

**Cliente real único**: ALGIA (`dac775fe-6ebd-47e3-89b4-eeb1a821facb`), sync corriendo cada hora (`30 * * * *`) en producción desde 2026-06-09.

### ⛔ Horarios (working_hours) — NO se importan de iSalud (decisión 2026-06-10)

**Política**: los `doctors.working_hours` se configuran **manualmente en Omuwan desde el dashboard**. Ningún auto-populate desde iSalud.

**Por qué se descartó importar de iSalud** (diagnóstico ejecutado y descartado):
- `/disponibilidad` **subestima** el horario real: muestra solo slots configurados para agendamiento web, no la jornada completa del médico.
- Las citas históricas también subestiman desde el ángulo opuesto (un médico que atiende 8–18 puede tener primera cita a las 9 y última a las 16).
- **Casos concretos de Algia que confirmaron la insuficiencia**:
  - **JOSÉ DUVÁN**: tiene 243 citas reales con rango 07–16 en mié/jue, pero `/disponibilidad` solo capturó 07–11. Importar desde ahí hubiera perdido ~121 citas reales.
  - **JORGE DARIO**: 10 citas reales en lunes, pero `/disponibilidad` lo marcaba INACTIVO.

**Qué quedó en el repo (útil a futuro, sin uso productivo)**:
- `src/lib/isalud/working-hours-derivation.ts` — lógica pura de derivación de patrón semanal (mode-based, split-shift, confidence levels). 26 tests verdes en `scripts/test-working-hours-derivation.ts`. Comentario al inicio del archivo explica el estado.
- `scripts/import-isalud-working-hours.ts` — script con default DRY-RUN. **Marcado en header como "DIAGNÓSTICO, NO usar para poblar producción"**. Sirve para correr el cruce iSalud-vs-realidad si en el futuro alguien quiere re-evaluar la fuente.

**Si en el futuro se quiere intentar de nuevo** auto-populate de horarios, la opción menos mala es **derivar de citas YA acumuladas en Omuwan** (no iSalud), porque:
- Respeta el principio "Omuwan independiente de iSalud"
- Las citas creadas en Omuwan son evento real (paciente confirmó hora con el agente)
- El módulo de derivación funciona tal cual — solo cambia la fuente de slots

Detalle del cruce numérico que descartó la idea: ver sesión 2026-06-10 en este archivo (búsqueda: "Cruce: /disponibilidad derivado vs citas reales").

---

## 🆕 Sesión del 6-7 junio 2026 — Trabajo del día

### Bug fixes deployados (orden cronológico)
1. **Hallucination de confirmación de identidad** (Lady reportó) — `src/lib/whatsapp/agent-guards.ts` con 4 guards puros (identidad, cancelación, reagendamiento, cita confirmada) + system prompt endurecido. 54 tests. Commit `ab71e83`.
2. **Distinguir EPS / Prepagada / Particular** (Sub-fase A) — migración `00071_add_insurer_type.sql` + `src/lib/utils/insurer-options.ts` con `{name, type, aliases, hasAmbiguity}` + tool `check_eps_convenio` acepta `insurer_type` opcional + dashboard UI con badges. 53 tests. Commit `3dfc17d`.
3. **TZ shift en check_availability** (Lady reportó) — `parseISO('YYYY-MM-DD')` → `parseISO('YYYY-MM-DDT12:00:00-05:00')` en `src/agents/tools/executor.ts:162`. Afectaba 25/29 doctores en 6 clínicas (86%). 36 tests. Commit `f4136ad`.
4. **omuwan.co pinned a deploy abril** — usado `npx vercel alias set` para promover deploy nuevo a omuwan.co + www.omuwan.co. Antes de esto, mis deploys quedaban en limbo y Lady chateaba con código de 7 semanas atrás. **Importante para futuro**: nunca usar `vercel deploy --prod` manual, queda anclado el dominio.

### Feature Resolución 256 — Fase 1 completo (6-7 jun 2026)

**Reporte semestral MinSalud Colombia** (Resolución 256 de 2016, Registro Tipo 2). Algia lo descarga directo de Omuwan con un click.

**Estado**: Fase 1 funcional para citas creadas en Omuwan. Fase 2 (pendiente mañana) cubre citas históricas iSalud.

#### Schema (migración `00072_resolucion_256_schema.sql`, APLICADA en prod)
- `patients`: + `first_name`, `middle_name`, `first_last_name`, `second_last_name`, `gender` (CHECK M/F), `eapb_code` VARCHAR(6) — todas nullable
- `patients.document_type` CHECK ampliado: `CC, TI, CE, PP, RC, PA, MS, AS`
- `appointments`: + `requested_at` TIMESTAMPTZ, `desired_at` DATE — nullable
- `consultation_types`: + `res256_category` CHECK (`Ginecología`, `Obstetricia`, `Ecografía`, `Resonancia Magnética`, `NoAplica`) — nullable
- Tabla nueva `eapb_codes` con 19 seed (12 EPS + 7 Prepagadas — `EPS037 Nueva EPS`, `PRE003 Coomeva Prepagada`, etc.)
- `clinics.feature_config.res256_enabled?: boolean` (activado para Algia via SQL UPDATE)

#### Archivos nuevos (lógica pura — testable sin DB)
- `src/lib/reports/resolucion-256/types.ts` — `Res256Row`, `Res256SourceRow`, `Res256ReportResult`
- `src/lib/reports/resolucion-256/column-mapping.ts` — `mapSourceRowToRes256Row` + `PISIS_COLUMNS_ORDER` + `PISIS_COLUMN_HEADERS` (12 cols exactas)
- `src/lib/reports/resolucion-256/validate.ts` — `validateRes256Row` + `REQUIRED_FIELDS` (10 obligatorios)
- `src/lib/reports/resolucion-256/dedup.ts` — `dedupFirstOfYear` (Gineco/Obst primera del año, Eco/RMN todas)
- `src/lib/reports/resolucion-256/xlsx-generator.ts` — `generateRes256Xlsx` con 2 hojas (`exceljs` dep nueva)
- `src/lib/reports/resolucion-256/query.ts` — `fetchSourceRows` con filtros (clinic_id, status, payment_type NOT IN Póliza/SOAT, fecha)
- `src/lib/utils/eapb-codes.ts` — `findEapbCodeByName` + `getEapbCodeFromInsurerOption` + `EAPB_CODE_PARTICULAR = 'NA'`
- `src/lib/utils/res256-heuristics.ts` — `suggestRes256Category` puro con regex por keyword. Casos dudosos (CONTROL POSQUIRURGICO, ENTREGA RESULTADOS, COLPOSCOPIA sola) retornan `null` intencionalmente

#### Endpoint y UI
- `GET /api/reports/resolucion-256?from=YYYY-MM-DD&to=YYYY-MM-DD` — valida rango (max 1 año, no futuro), retorna xlsx con headers `X-Res256-Ready` y `X-Res256-Incomplete`
- `/dashboard/reportes` (hub) + `/dashboard/reportes/resolucion-256` — date pickers default semestre actual + botón descarga + summary
- `/dashboard/configuracion/res256-categories` — bulk-classify con sugerencias en gris, checkbox por tipo, batch action "Aplicar sugerencias seleccionadas". Link desde reporte: "¿No ves citas? Clasifica primero"
- Sidebar item "Reportes" condicional a `feature_config.res256_enabled` (item `hideIfFeatureDisabled` en NavItem)
- Dropdown `res256_category` agregado a `TypeExpandedEditor` en `doctor-detail.tsx` (Task 7, además del bulk-classify)
- Patient form: 4 campos nombre + gender + eapb_code dropdown
- Appointment form: campo `desired_at` opcional

#### Server actions
- `classifyRes256Category(consultationTypeId, category)` — individual
- `applyRes256Suggestions(classifications[])` — batch para bulk-classify page

#### Tests
- `test-res256-column-mapping.ts` (24), `test-res256-validate.ts` (17), `test-res256-dedup.ts` (12), `test-res256-xlsx.ts` (13), `test-res256-heuristics.ts` (23), `test-eapb-codes.ts` (12) — **total 101 nuevos**
- Regresivos (insurer-options, agent-guards, availability-tz) — 137 siguen verdes
- **Total suite: 238 tests pasando**
- Smoke E2E (`scripts/smoke-res256-e2e.ts`) contra prod data de Algia — heurística cubre 16/20 tipos, 4 sin sugerencia (esperado)

#### Reglas regulatorias en código
- `EXCLUDED_PAYMENT_TYPES = ['Póliza', 'SOAT']` en query (art. 2 de la resolución)
- Dedup primera-del-año solo para Gineco/Obst (Eco/RMN todas)
- `EAPB_CODE_PARTICULAR = 'NA'` para particulares (formato PISIS)
- Document type `PP` (interno) mapea a `PA` (formato PISIS) en column-mapping
- Pacientes sin documento usan `MS` (menor) o `AS` (adulto) — staff selecciona

### 🚨 PENDIENTE CRÍTICO — Auditar `eapb_codes` contra catálogo oficial MinSalud

**Estado** (2026-06-10, descubierto al diseñar feature convenios doctor-first): los códigos del seed `eapb_codes` (migración 00072) **pueden NO ser los oficiales del catálogo SISPRO**, a pesar de lo que dice el comentario de la migración. Hallazgos durante investigación:

- **EPS017 y EPS018 aparecen cruzados**: el seed dice `EPS017=Famisanar` y `EPS018=Sanitas EPS`, pero dos fuentes externas independientes ([DSSA](https://www.dssa.gov.co/images/salud/herramientas/paisoft2/tablas/13_Administradoras.pdf), búsqueda cross-source confirmando) indican `EPS017=Coomeva EPS` y `EPS018=EPS Famisanar Ltda`.
- **Prefijo "PRE" para prepagadas probablemente NO existe** en SISPRO. Las fuentes oficiales mencionan prefijos `EPS`, `EMP`, `EAS` (entidades adaptadas). Nuestros `PRE001..PRE007` son **códigos internos inventados al armar el seed**.
- **PRE007 = "MediPlus" tiene typo**: el oficial es "MedPlus" (sin i) confirmado en el sitio oficial + iSalud productivo.

**No se ha enviado nada al MinSalud aún** — Algia no ha generado ningún reporte Res-256. Pero el primer reporte que se descargue tendrá códigos potencialmente inválidos.

**Por qué NO se arregló al descubrirlo**: la auditoría requiere el catálogo oficial completo del MinSalud/SISPRO (no accesible via WebFetch en formato parseable). El trabajo es regulatorio y necesita input de Lady/Algia cumplimiento + tiempo dedicado. Esto NO bloquea el feature de convenios para agendar (que usa el **nombre** del convenio, no el código).

**Antes de que Algia genere el primer reporte Res-256, hacer**:
1. Conseguir el catálogo SISPRO oficial 2026 en formato accesible (CSV/Excel desde [datos.gov.co](https://datos.gov.co), o API REPS si existe pública)
2. Auditar los 19 códigos actuales contra el catálogo
3. Corregir cruces (EPS017/EPS018) y el prefijo PRE→ el oficial (probablemente EAS)
4. Re-verificar nombres (MedPlus, etc.)
5. Re-correr la suite de tests Res-256 con códigos corregidos

**Fuentes consultadas en la investigación**:
- [Tabla DSSA Administradoras](https://www.dssa.gov.co/images/salud/herramientas/paisoft2/tablas/13_Administradoras.pdf) (PDF, formato no parseable directo)
- [Listado SISPRO EAPB por IPS](https://sig.sispro.gov.co/aihospitalcontigo/pdf/listadoeapbxips_publicar.pdf) (PDF idem)
- [Título II EAPB SuperSalud](https://docs.supersalud.gov.co/PortalWeb/metodologias/OtrosDocumentosMetodologias/Titulo%20II%20EAPB.pdf)
- Sitio oficial [medplus.com.co](https://medplus.com.co) confirmando escritura "MedPlus" sin i

### Deuda técnica para mañana (Fase 2)
1. **PRÓXIMO PRIORITARIO**: mejorar sync iSalud (`src/lib/isalud/`) para parsear campos Res-256 (`birth_date`, `gender`, `eapb_code`, `requested_at`, `res256_category` heurístico desde `procedimiento`) desde `external_data` antes del sync real de Algia. Sin esto, las 498 citas iSalud no aparecen en el reporte.
2. Tabla `appointment_res256_complement` para que staff complete manualmente campos faltantes por cita histórica
3. UI CRUD para `eapb_codes` (hoy es seed estático) — combinable con la auditoría arriba
4. Captura demográfica via agente WhatsApp (Fase 3) — modificar prompt + nueva tool `capture_demographic_data`
5. Validación de cédula contra Registraduría (futuro)

### Comandos útiles del feature
- Bulk smoke: `TZ=America/Bogota npx tsx scripts/smoke-res256-e2e.ts`
- Suite completa Res-256: `for t in test-eapb-codes test-res256-column-mapping test-res256-validate test-res256-dedup test-res256-xlsx test-res256-heuristics; do npx tsx scripts/${t}.ts | tail -1; done`
- Activar feature en otra clínica: `UPDATE clinics SET feature_config = COALESCE(feature_config, '{}'::jsonb) || '{"res256_enabled": true}'::jsonb WHERE id = '<UUID>'`

### Plan completo de implementación
`docs/superpowers/plans/2026-06-06-resolucion-256.md` — Fase 1 ejecutada via subagent-driven-development (15 tasks + Task 13.5 bulk-classify). Plan tiene también el roadmap de Fase 2 y 3.

### Manual de usuario
`docs/REPORTE_RES256.md` — Para Lady y futuros usuarios.

---

*Última actualización: 7 de junio 2026 | Versión: 2.1 — Piloto Algia + iSalud Sync + Resolución 256 Fase 1*
