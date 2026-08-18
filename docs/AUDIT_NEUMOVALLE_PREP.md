# Audit: Prep Cliente Neumovalle

**Fecha:** 2026-05-20
**Cliente:** Neumovalle — 7 doctores, plan Red ($1.090k/mes)
**HIS actual:** Saludtools (plan por confirmar, sospechamos Premium con API)

---

## PARTE 1: AUDIT DE CREACIÓN DE CUENTA Y ONBOARDING

### 1. Flow de registro con código (/register/invite)

| Check | Estado | Detalle |
|---|---|---|
| Paso 1: Datos clínica | ✅ OK | Nombre, especialidades (multi-select), rango doctores (1/2-3/4-6/7-10) |
| Paso 2: Cuenta admin | ✅ OK | Código invitación, nombre, email, contraseña (min 10 chars), confirmación |
| Validación código | ✅ OK | Case-insensitive contra `VALID_INVITE_CODES` env var |
| Creación clínica | ✅ OK | Slug auto, trial 14 días, features core habilitadas |
| 5 roles default | ✅ OK | Admin, Coordinadora, Doctor, Secretaria, Contador |
| Admin permissions | ✅ OK | 10 módulos read+write incluyendo `user_management` |
| Redirect post-registro | ✅ OK | → `/onboarding` automático |
| "Contraseña" con ñ | ✅ OK | Corregido en commit anterior |

### 2. Wizard de onboarding (3 pasos)

| Check | Estado | Detalle |
|---|---|---|
| Paso 1: Consultorio | ✅ OK | Nombre, dirección, ciudad (default Pereira), teléfono |
| Paso 2: Equipo | ⚠️ BUG | Dropdown de roles puede no cargar — usa `useState` en vez de `useEffect` (línea 153) |
| Paso 3: Listo | ✅ OK | Checklist de próximos pasos, `markOnboarded()`, redirect a dashboard |
| Sin paso WhatsApp | ✅ OK | Eliminado correctamente, dirigido a Settings |
| `onboarded_at` se setea | ✅ OK | `markOnboarded()` hace UPDATE en clinics |

**BUG ENCONTRADO:** `src/app/onboarding/page.tsx:153` — `useState(() => { getClinicRoles().then(setRoles) })` debería ser `useEffect`. El dropdown de roles en Step 2 puede no cargar correctamente. **Severidad: MEDIA** — el paso es skipeable pero si intentan invitar equipo, no funciona.

### 3. Permisos del admin recién creado

| Check | Estado | Detalle |
|---|---|---|
| Rol Admin completo | ✅ OK | 10 módulos read+write |
| Ve "Configuración" en sidebar | ✅ OK | `user_management.read = true` |
| Puede agregar doctores | ✅ OK | `settings.write = true` |
| Puede invitar equipo | ✅ OK | `user_management.write = true` |

### 4. Estado inicial del dashboard (vacío)

| Check | Estado | Detalle |
|---|---|---|
| 0 doctores | ✅ OK | No crashea, array vacío |
| 0 citas | ✅ OK | KPIs muestran 0 |
| 0 conversaciones | ✅ OK | Sin error |
| Banner WhatsApp | ✅ OK | Aparece cuando `whatsapp_phone_id = null` |
| Sidebar completo | ✅ OK | Todos los items con tildes correctas |

### 5. Bugs conocidos verificados

| Bug | Estado |
|---|---|
| "Contraseña" con ñ | ✅ Corregido |
| Sidebar tildes | ✅ Corregido (Operación, Configuración) |
| Login post-registro | ✅ Funciona (auto-signin en registerAction) |
| Cuenta asociada a clínica | ✅ clinic_users creado correctamente |

### RESUMEN PARTE 1

**Score: 95% listo.** Un bug en Step 2 del onboarding (useState → useEffect para cargar roles). Fix: 5 minutos. El resto funciona correctamente.

---

## PARTE 2: AUDIT DE SALUDTOOLS

### 1. Documentación pública

| Aspecto | Estado | Detalle |
|---|---|---|
| Portal developer | ✅ EXISTE | `developer.saludtools.com` — contenido gated (requiere cuenta Premium) |
| Webhooks | ✅ EXISTE | `developer.saludtools.com/webhook` — detalles no públicos |
| API REST documentada | ⚠️ GATED | Existe pero solo visible con credenciales Premium |
| Endpoints públicos | ❌ NO VISIBLE | URLs, payloads, schemas no disponibles sin login |
| Sandbox | ❓ DESCONOCIDO | Mencionan "credenciales testing vs producción" |

### 2. Autenticación

- **Método:** API Key → token temporal (similar a OAuth client credentials)
- **Credenciales:** Separadas para testing y producción
- **Portal:** `developer.saludtools.com` (requiere cuenta Premium)

### 3. Modelo comercial de la API

| Plan | Precio COP/mes | API incluida |
|---|---|---|
| Standard | $89.000 | ❌ NO |
| Plus | $147.000 | ❌ NO |
| **Premium** | **$168.000** | **✅ SÍ** — "API de integraciones" |

**Para 7 doctores de Neumovalle:** $168.000 × 7 = **$1.176.000 COP/mes** solo por Saludtools Premium. Descuento anual: 10%.

### 4. Integraciones conocidas de Saludtools

- Doctoralia (agenda sync bidireccional)
- Siigo (contabilidad)
- Google Calendar
- PayU (pagos)
- SURA (EPS en tiempo real)
- Mipres, IHCE/RDA (gobierno)

### 5. Comparación con iSalud

| Aspecto | Saludtools | iSalud |
|---|---|---|
| API REST | ✅ Sí (Premium) | ❌ No — scraping |
| Webhooks | ✅ Sí | ❌ No |
| Developer portal | ✅ Sí | ❌ No |
| Autenticación | API Key + token | Login HTTP + cookies |
| Approach para Omuwan | API directa | Playwright headless |
| Estándar | FHIR R4 + JSON | HTML scraping |

### 6. Estimación de integración

| Escenario | Horas | Requisitos |
|---|---|---|
| API REST documentada + webhooks | 15-20h | Neumovalle en plan Premium, docs accesibles |
| API con docs limitadas (reverse engineer) | 25-35h | Acceso al portal developer con credenciales |
| Scraping (fallback, como iSalud) | 30-40h | No recomendado si API existe |

### 7. Reutilización de código iSalud

**Parcial.** La arquitectura se puede reusar:
- `sync_integrations` tabla → ya provider-agnóstica
- `doctor_external_mappings` tabla → reutilizable
- `appointments.external_source` / `external_data` → reutilizable
- `src/app/api/sync/` cron pattern → reutilizable

**NO se reusan:** Playwright/scraping, login HTTP, datepicker manipulation. Se reemplazan por llamadas REST API + procesamiento JSON.

---

## COSAS QUE NECESITAMOS PEDIRLE A NEUMOVALLE

1. **¿Están en plan Premium de Saludtools?** Si no, necesitan upgrade para que tengamos acceso a la API
2. **Credenciales de API** (API key testing + producción)
3. **Acceso al portal developer.saludtools.com** para leer documentación
4. **Lista de doctores** con nombre, especialidad, horarios
5. **Lista de EPS/convenios** que aceptan
6. **Número de WhatsApp Business** (o si necesitan uno nuevo)
7. **Admin principal** — email + nombre para crear cuenta

## TIMELINE PROPUESTO

| Semana | Actividad |
|---|---|
| Semana 1 | Crear cuenta Neumovalle + onboarding + configurar doctores/horarios |
| Semana 1-2 | Conectar WhatsApp Business API |
| Semana 2-3 | Integración Saludtools (con API docs) |
| Semana 3 | Testing end-to-end + ajustes |
| Semana 4 | Go-live con agente operativo |

## FIX PENDIENTE ANTES DE NEUMOVALLE

1. **BUG onboarding Step 2:** `useState` → `useEffect` para carga de roles (5 min)
