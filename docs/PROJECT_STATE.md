# Omuwan — Estado del Proyecto (Abril 2026)

## 1. RESUMEN EJECUTIVO

Omuwan es un SaaS B2B que provee un agente de IA por WhatsApp para consultorios medicos en Colombia. El agente agenda citas, responde FAQ, envia recordatorios y reduce no-shows — reemplazando tareas de secretaria 24/7.

**Estado:** Piloto en produccion con 1 clinica real (Algia Clinica, Pereira). MVP funcional con rediseno UI v2 completado. Modelo de negocio: setup + mensualidad.

**Cliente piloto:** Algia Clinica (clinic_id: `dac775fe-6ebd-47e3-89b4-eeb1a821facb`), 9 medicos, especialidad ginecologia/obstetricia. Admin: Lady Leon.

---

## 2. STACK Y ARQUITECTURA

### Frontend + Backend
- **Next.js 16.2.3** (App Router) + **React 19.2.3** + **TypeScript 5** (strict: true)
- **Tailwind CSS 4** (v4 CSS-first config via `@theme inline`)
- **Fuentes:** Manrope (sans), Instrument Serif (decorativo), JetBrains Mono (datos)
- Design tokens v2 con prefijo `--v2-*` en globals.css

### Base de datos
- **Supabase** (PostgreSQL + Auth + Realtime)
- 62 migraciones aplicadas (00001 a 00062, excluye dropped financials)
- RLS activo en todas las tablas criticas
- Multi-tenant via `clinic_id` en cada tabla

### IA
- **Anthropic Claude API** — modelo `claude-sonnet-4-20250514`
- 8 tools de function calling (check_availability, create_appointment, etc.)
- System prompt dinamico (~656 lineas) construido per-conversation
- Max tokens: 1024, Temperature: 0.3

### WhatsApp
- **WhatsApp Business Cloud API** (Meta Graph v21)
- Webhook: `POST /api/webhooks/whatsapp`
- Credenciales per-clinic en tabla clinics (plaintext — SEC-001 pendiente)
- Verificacion HMAC SHA-256 de cada webhook

### Deployment
- **Vercel** — URL produccion: **https://omuwan.co**
- Deploy **manual**: `npx vercel --prod --scope executiveteam-oss-projects`
- NO auto-deploy desde Git
- Vercel Pro (250MB functions, necesario para Playwright/Chromium)

### Crons activos (vercel.json)
| Cron | Schedule | Funcion |
|------|----------|---------|
| send-reminders | Cada hora | Recordatorios 72h, 24h, 2h antes de citas |
| morning-report | 6am COT | Reporte matutino al doctor por WhatsApp |
| post-consulta | 9am COT | Seguimiento post-cita (NPS) |
| reactivacion | 10am lunes | Contactar pacientes inactivos |
| reopen-agendas | 5am COT | Reabrir agendas cerradas temporalmente |
| weekly-report | 8am lunes | Resumen semanal de no-shows |
| sync/isalud | Cada 30 min | Sincronizar agenda desde iSalud |

---

## 3. FEATURES IMPLEMENTADAS

### Agente WhatsApp (CORE — completa)
- **Archivos:** `src/agents/`, `src/app/api/webhooks/whatsapp/route.ts` (1,021L)
- 8 tools: check_availability, create_appointment, cancel_appointment, reschedule_appointment, get_patient_appointments, escalate_to_human, add_to_waitlist, check_eps_convenio
- Maneja: EPS/convenios, multiples doctores, tipos de consulta, horarios multi-bloque, franjas por tipo, modalidad virtual/presencial, documentos previos, motivo libre
- Post-cita lockout, SLOT_JUST_TAKEN handling, reagendamiento post-cancelacion

### Dashboard v2 (completa)
- **Landing publica:** https://omuwan.co/ (11 secciones, responsive)
- **Login:** split-screen con visual side dark
- **Dashboard home:** hero greeting dinamico, 4 KPIs, proximas citas, escalaciones, agent week stats
- **Agenda:** vista dia/semana/mes, overlap handling, URL state, keyboard shortcuts, click-to-book empty slots, bulk cancel dia
- **Conversaciones:** lista con realtime, chat con context panel, escalation flow
- **Pacientes:** lista con tabs (todos/recientes/leales/riesgo), detalle con timeline, WhatsApp directo
- **No-Shows:** hero stat con comparacion temporal, range selector, chart weekday, risk patients
- **Sidebar v2:** gradient active state, secciones Operacion/Configuracion
- **Tu agente:** personalidad, conexion, escalamiento, automatizaciones, plantillas, metricas
- **Doctors management:** /settings/doctors con lista + detalle 4 tabs (datos, horario, tipos consulta con franjas, bloqueos)

### Sistema de recordatorios (completa)
- Recordatorio 72h, 24h, 2h antes
- Confirmacion por WhatsApp (paciente responde SI/NO)
- Documentos previos requeridos
- Seguimiento post-consulta con NPS

### No-shows management (completa)
- Probabilidad de no-show por paciente
- Dashboard analitico con trends
- Alertas de pacientes en riesgo
- Costo estimado por tipo de consulta

### Lista de espera (completa)
- Prioridad por scoring (pago, frecuencia, no-shows, tiempo espera)
- Notificacion automatica cuando se libera slot
- Formulario WhatsApp para agregar

### iSalud Integration (completa)
- Scraping con Playwright + @sparticuz/chromium
- Import de medicos, citas bloqueadas, convenios/tarifas
- Sync cada 30 min via cron
- Citas iSalud aparecen como `blocked_external` (purpura en calendario)

### Onboarding (completa)
- Wizard multi-step para nuevas clinicas
- Setup checklist post-onboarding
- Doctor onboarding con welcome modal

### RBAC (completa)
- 10 modulos × read/write
- 5 roles predefinidos: Admin, Secretaria, Doctor, Contador, Super Admin
- Doctor solo ve sus citas, no puede gestionar config
- Permisos editables desde /settings/roles

### Features ELIMINADAS (cleanup estrategico, abril 2026)
- ❌ Analytics dashboard (→ STRADmed)
- ❌ Cartera (→ STRADmed)
- ❌ Facturacion + glosas (→ STRADmed)
- ❌ Asistente IA dashboard (staff chat interno)
- ❌ Insights AI (profitability advisor)
- Tablas dropeadas: cartera, invoices + 18 columnas financieras de appointments

---

## 4. ESQUEMA DE DATOS (SUPABASE)

### Tablas principales

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| clinics | Tenant principal | name, specialty[], whatsapp_*, agent_name, agent_personality, whatsapp_config JSONB, feature_config JSONB |
| doctors | Medicos por clinica | name, specialty, working_hours JSONB (multi-block), agenda_closed, schedule_type |
| patients | Pacientes (auto-creados por WA) | name, phone (+57), eps, document_type/number, no_show_count, total_appointments |
| appointments | Citas | starts_at, ends_at, status, payment_type, eps_name, source, consultation_type_id, modality |
| conversations | Chats WA | status (active/escalated/resolved), patient_id, last_message_at |
| messages | Mensajes individuales | role (patient/agent/staff), content, conversation_id |
| consultation_types | Tipos por doctor | name, duration, price, eps_name, bookable_via_whatsapp, requires_documents |
| consultation_type_schedules | Franjas horarias por tipo | day_of_week, start_time, end_time |
| blocked_dates | Bloqueos de agenda | doctor_id (nullable=clinica), start_date, end_date, reason |
| clinic_users | Usuarios vinculados | auth_user_id, clinic_id, role_id, doctor_id |
| clinic_roles | Roles con permisos | name, permissions JSONB |
| waitlist | Lista de espera | patient_id, doctor_id, status, preferred_dates |
| reminders | Recordatorios enviados | appointment_id, type, status, response |
| audit_log | Auditoria | action, actor_type, target_type, details JSONB |
| sync_integrations | Config iSalud | credentials JSONB, sync_status, last_synced_at |
| isalud_import_staging | Buffer temporal para importar convenios | convenio_nombre, producto_nombre, tarifa |
| clinic_setup_progress | Checklist de activacion | 5 booleans de pasos |

### Relaciones FK
- appointments → clinics, doctors, patients, consultation_types
- conversations → clinics, patients
- messages → conversations
- doctors → clinics
- patients → clinics (UNIQUE clinic_id + phone)
- consultation_types → clinics, doctors
- consultation_type_schedules → consultation_types
- blocked_dates → clinics, doctors (nullable)
- clinic_users → clinics, clinic_roles

### RLS
Activo en TODAS las tablas principales. Politicas basadas en `clinic_id IN (SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid())`.

---

## 5. INTEGRACION WHATSAPP

### Webhook
- GET `/api/webhooks/whatsapp` — verificacion Meta (verify_token)
- POST `/api/webhooks/whatsapp` — recibe mensajes (HMAC validated)
- Flujo: identify clinic → find/create patient → find/create conversation → save message → run agent → send response

### Templates aprobados
Templates hardcodeados en codigo (no editables desde UI):
- Recordatorio 24h: "Hola {nombre}, te recordamos tu cita manana..."
- Recordatorio 2h: solo para pacientes con historial no-show
- Confirmacion de cita: "{nombre}, tu cita quedo agendada..."
- Cancelacion empatica: con 3 opciones de reagendamiento
- Aviso de privacidad: Ley 1581/2012 (primer contacto)

### Flujos implementados
1. **Agendar cita:** paciente pide → agente pregunta doctor/tipo/fecha → check_availability → confirma → create_appointment
2. **Cancelar/reagendar:** paciente pide → cancel/reschedule con opciones
3. **FAQ:** horarios, precios, ubicacion, EPS aceptadas
4. **Emergencia:** detecta palabras clave → escala inmediatamente
5. **Post-cancelacion:** paciente responde al msg de cancelacion → agente reagenda sin re-preguntar datos

---

## 6. CLIENTE PILOTO: ALGIA

- **clinic_id:** `dac775fe-6ebd-47e3-89b4-eeb1a821facb`
- **9 medicos** importados desde iSalud con working_hours configurados
- **URL iSalud:** `https://algia.isalud.co/`
- **Especialidades:** ginecologia, obstetricia
- **Admin:** Lady Leon
- **iSalud sync:** activo cada 30 min, citas bloqueadas en calendario
- **Status piloto:** en produccion, agente respondiendo pacientes reales

---

## 7. BUGS CONOCIDOS Y DEUDA TECNICA

### Criticos
- **SEC-001:** WhatsApp credentials (access_token, app_secret) almacenados en plaintext en DB. Pendiente: encryption at rest.
- **Rate limiter:** Upstash Redis activo en produccion. Fallback in-memory si Upstash falla. Ver docs/RATE_LIMITING.md.

### Deuda tecnica
- **whatsapp-config-form.tsx (2,566L):** monstruo legacy. Maneja doctores + tipos + horarios + config. Parcialmente reemplazado por /settings/doctors y /tu-agente pero sigue accesible en /dashboard/whatsapp.
- **0 tests:** ningun archivo de test en todo el codebase (39,542 lineas sin tests)
- **91 lint issues:** 24 require() en scripts/, 21 React patterns en monstruo, 46 unused vars — todos en archivos de sprints futuros
- **Console.log:** 162 logs operativos en server-side (webhook, cron, isalud). No hay logger structured.
- **avgResponseTime hardcodeado:** "< 1 min" en dashboard y tu-agente. No se calcula en realidad.

### Workarounds activos
- `/dashboard/whatsapp` (monstruo) sigue accesible por URL directa como fallback para config de doctores
- `daily_goal_appointments` columna dropeada en DB pero referenciada en algunos tipos (limpiado en codigo pero puede haber data legacy)

---

## 8. PROXIMOS PASOS

### En progreso al cierre
- Sprint 3 (seguridad) parcialmente completado: rate limiter con Upstash preparado, encryption diferida
- Cleanup Sprints 1-2.5 completados: utils centralizados, legacy CSS migrado, hex colors parcialmente, lint parcial

### Decisiones pendientes
- ~~Activar Upstash Redis~~ ✅ Activo en produccion (abril 2026)
- Encryption de WhatsApp credentials (pgcrypto vs app-level vs Supabase Vault)
- Decomposition del monstruo (whatsapp-config-form.tsx, Sprint 5 del cleanup plan)
- Testing framework (vitest setup, Sprint 4 del cleanup plan)

### Backlog inmediato
- Migracion de paginas settings restantes (users, roles, integrations, system-status, import-isalud) a v2 visual — legacy CSS ya migrado, pero layout/UX no
- AppointmentFormModal (448L) necesita restyling v2
- /dashboard/espera necesita refactor v2 (633L, legacy visual)
- /dashboard/vacaciones necesita refactor v2

---

## 9. COMANDOS Y WORKFLOWS CLAVE

### Desarrollo local
```bash
npm run dev          # localhost:3000
npm run build        # Build produccion
npm run lint         # ESLint
npx tsc --noEmit     # Type-check
```

### Deploy (MANUAL, no auto-deploy)
```bash
npx vercel --prod --scope executiveteam-oss-projects
```

### Supabase
```bash
npx supabase start   # DB local
npx supabase db push # Aplicar migraciones a produccion
npx supabase gen types typescript --local > src/types/database.ts
```

### Variables de entorno necesarias
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
WHATSAPP_APP_SECRET          # HMAC validation global
CRON_SECRET                  # Bearer token para crons
NEXT_PUBLIC_APP_URL
GOOGLE_SERVICE_ACCOUNT_EMAIL # Google Sheets sync
GOOGLE_PRIVATE_KEY
UPSTASH_REDIS_REST_URL       # Rate limiter Upstash Redis (activo)
UPSTASH_REDIS_REST_TOKEN     # Rate limiter Upstash Redis (activo)
```

---

## 10. CONTEXTO DE NEGOCIO

### Pricing actual (COP/mes)
| Plan | Medicos | Precio |
|------|---------|--------|
| Solo | 1 | $390k |
| Equipo | 2-3 | $620k |
| Clinica | 4-6 | $850k |
| Red | 7-10 | $1.090k |

15 dias prueba, sin tarjeta, sin permanencia.

### Modelo de venta
- Demos presenciales por Alejandra
- Onboarding en 7 dias (configuracion por el equipo)
- WhatsApp como canal principal de soporte (573015525881)
- Email: hola@omuwan.co
- Empresa: Lonco Capital S.A.S., Pereira, Colombia

### Metricas tracking
- Mensajes del agente por dia
- Tasa de no-show (rolling 30 dias)
- Conversaciones resueltas sin humano (%)
- Citas agendadas por el agente
- Tiempo respuesta (~3s hardcodeado, no medido realmente)

---

## INCONSISTENCIAS CODIGO vs CLAUDE.md

1. **CLAUDE.md menciona `daily_goal_appointments`** — columna dropeada en migracion 00062, removida del codigo. CLAUDE.md desactualizado.
2. **CLAUDE.md menciona tablas `cartera`, `invoices`** — dropeadas en migracion 00062. CLAUDE.md desactualizado.
3. **CLAUDE.md menciona `Wompi` para pagos** — nunca implementado, no hay integracion de pagos.
4. **CLAUDE.md dice `reminder_2h_sent`** — el campo existe pero se llama `reminder_2h_sent` en schema, y la logica de 2h solo envia a pacientes de alto riesgo.
5. **CLAUDE.md lista 6 tools** — el agente tiene 8 tools (se agregaron `add_to_waitlist` y `check_eps_convenio`).
6. **CLAUDE.md dice `claude-sonnet-4-20250514`** — correcto, este es el modelo en uso.
7. **CLAUDE.md iSalud section** esta al dia con la implementacion real.
8. **Pricing en CLAUDE.md** (Basic $150k / Pro $300k) no coincide con pricing actual en landing (Solo $390k / Equipo $620k / Clinica $850k / Red $1.090k).
