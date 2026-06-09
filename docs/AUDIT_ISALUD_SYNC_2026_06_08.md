# Auditoría sync iSalud — 8 de junio 2026

> **Contexto:** Pre-Fase 2 del feature Resolución 256. Lady necesita que las 498 citas históricas iSalud aparezcan en el reporte; eso requiere mejorar el sync para parsear campos demográficos hoy guardados en `external_data` JSONB.
> **Estado actual del sync:** ⚠️ **ROTO desde 2026-04-21** (48 días sin importar nada nuevo, status pegado en `'running'`).

---

## 1. Estado de la integración

### 1.1 `sync_integrations` para Algia

| Campo | Valor |
|---|---|
| provider | `isalud` |
| **sync_status** | **`running` ← pegado** |
| **last_synced_at** | **2026-04-21 13:34:45 UTC** (hace 48 días) |
| sync_error | `null` (silent failure) |
| credentials.subdomain | `algia` |
| credentials.username | (set, encriptado) |
| credentials.password | (set, encriptado) |
| config.dias_adelante | `60` |
| updated_at | 2026-04-21 14:34:28 UTC |

**Interpretación:** El sync arrancó el 21 abril, seteó `status='running'`, y nunca terminó de actualizar el status. O el código crashea entre `update status='running'` y el `try/catch` que escribiría `error`, o el proceso es matado por timeout antes de llegar al catch.

### 1.2 Cron schedule

`vercel.json` línea relevante:
```json
{ "path": "/api/sync/isalud", "schedule": "30 * * * *" }
```

Corre cada hora a los 30 minutos. Esperaríamos ~1152 ejecuciones en 48 días.

### 1.3 Audit log

Las últimas entradas relacionadas a iSalud son del **2026-04-23** (`isalud_convenios_imported_for_doctor`). Nada del sync de admisiones en sí, lo cual es normal porque el sync no escribe a audit_log (sí escribe a `sync_integrations.last_synced_at` cuando completa).

### 1.4 Citas importadas en `appointments`

```
total citas isalud: 498
first synced:       2026-04-15 23:34:08
last synced:        2026-04-21 13:34:45   ← último import exitoso
earliest apt:       2026-04-15
latest apt:         2026-05-29           ← cita más adelantada importada
```

Hoy es 2026-06-08. iSalud presumiblemente tiene citas hasta julio o más, pero las 498 que tenemos llegan solo a fines de mayo (consistente con `dias_adelante=60` desde el 21 abril).

### 1.5 Logs de Vercel para `/api/sync/isalud`

Consulté runtime logs últimos 3 días: **0 logs encontrados** con query "isalud". El cron probablemente está fallando ANTES de llegar a `console.log`, o los logs caducaron (Vercel free tier retiene poco). Necesitaríamos check del dashboard de Vercel para certeza.

---

## 2. Test de conexión mínima

Ejecuté curl directo a `https://algia.isalud.co/`:

| Check | Resultado |
|---|---|
| HTTP 200 | ✅ |
| Servidor PHP/5.6.40 | ✅ (sin cambios) |
| Cookie de sesión `symfony` emitida | ✅ |
| Form de login presente | ✅ |
| `name="login[Usuario]"` | ✅ |
| `name="login[Clave]"` | ✅ |
| `name="login[_csrf_token]"` | ✅ |
| `action="/autenticacion/login"` | ✅ |
| CSRF token emitido (~13 chars hex) | ✅ |

**Conclusión:** iSalud sigue UP y su UI **no cambió** desde abril. La estructura del form de login coincide exactamente con la que `adapter.ts` espera (líneas 99-180). **El sync rompió por otra razón.**

### 1.6 Hipótesis del fallo

| # | Hipótesis | Probabilidad | Cómo verificar |
|---|---|---|---|
| H1 | Credenciales rotadas en iSalud (password expirado / cambiado) | **Alta** | Hacer login manual con las creds que están en DB y ver si pasan |
| H2 | Vercel Pro plan / Playwright timeout (cron > 5 min) | Media | Logs de Vercel `function-execution-timeout` |
| H3 | `@sparticuz/chromium` binary issue (versión obsoleta) | Media | Versión actual: v131.0.1; chequear si Vercel cambió runtime |
| H4 | El status `'running'` previo bloquea futuras corridas | Baja | Mirar `syncAllISaludIntegrations` en sync-agent.ts:65 — no veo guard que skip 'running', así que esto NO debería bloquear |
| H5 | iSalud bloqueó la IP de Vercel (anti-bot) | Baja | Check si el login HTTP falla con 403 desde Vercel |
| H6 | El cron está deshabilitado en Vercel dashboard | Media | Check dashboard → Crons |

---

## 3. Mapa de extracción actual

### 3.1 Páginas iSalud que se navegan

| URL | Cuándo | Qué extrae |
|---|---|---|
| `GET /` | login | CSRF token + cookies iniciales |
| `POST /autenticacion/login` | login | Submit form, retrieve session cookie |
| `GET /disponibilidad` | scrape doctores | Lista de profesionales con sus puntos de atención |
| `GET /admision` | scrape citas | Tabla de citas (todas las fases `Programado` + `Admitido`) |

**Pages que NO toca el sync:**
- `/pacientes` — directorio de pacientes (probablemente tiene birth_date, gender, email)
- `/agendamiento` — módulo de creación de citas (podría tener fecha de solicitud)
- `/historia_clinica` — historia clínica (irrelevante para Res-256)

### 3.2 Columnas extraídas de la tabla `/admision`

Selector: `table tbody tr` con ≥15 `<td>`. Mapeo por índice de columna:

| Índice | Campo | Ejemplo | Uso actual |
|---|---|---|---|
| c[0] | `id` | `52277` | external_data.id + componente de `external_his_id` |
| c[1] | `identificacion` | `CC 36306619` | external_data.identificacion (sin split) |
| c[2] | `nombre_paciente` | `LINA MARIA OTALORA TOVAR` | appointment.reason + external_data + notes |
| c[3] | `procedimiento` | `consulta de primera vez por especialista en ginecologia y obstericia` | external_data.procedimiento + notes |
| c[4] | `aseguradora` | `COLSANITASRégimen: EspecialTipo afiliado: Tomador/Amparado Planes voluntarios de salud` | external_data.aseguradora + notes |
| c[5] | `profesional_nombre` | `JUAN DIEGO VILLEGAS ECHEVERRI` | external_data + mapping a doctor_id |
| c[6] | `ubicacion` | `Consultorio 3 Oval` | external_data.ubicacion + notes |
| c[7] | `hora_inicial` | `10:00` | starts_at |
| c[8] | `fase` | `Programado` / `Admitido` | filter |
| c[14] | `fecha` (DD/MM/YYYY) | `29/05/2026` → `2026-05-29` | starts_at |
| c[15] | `hora_final` | `10:20` | ends_at |

**Filas que se descartan**: las que tienen `fase` distinto de `Programado` o `Admitido`. Y las que tienen menos de 15 columnas (defensiva).

### 3.3 Dónde se persiste lo extraído

Tabla `appointments`:

| Columna | Origen iSalud | Ejemplo |
|---|---|---|
| `clinic_id` | (fijo de la integración) | `dac775fe-...` |
| `doctor_id` | mapping desde `profesional_nombre` via `doctor_external_mappings` | `97a20f5e-...` |
| `patient_id` | **NULL** (sin link) | — |
| `starts_at` | `${fecha}T${hora_inicial}:00-05:00` | `2026-05-29T10:00:00-05:00` |
| `ends_at` | `${fecha}T${hora_final}:00-05:00`, fallback +30min | `2026-05-29T10:20:00-05:00` |
| `status` | `confirmed` si hay paciente, `blocked_external` si no | `confirmed` |
| `source` | hardcoded `'isalud'` | `isalud` |
| `external_source` | hardcoded `'isalud'` | `isalud` |
| `external_his_id` | `isalud-{id}-{fecha}` | `isalud-52277-2026-05-29` |
| `external_data` | objeto admision completo (jsonb) | `{id,fase,fecha,nombre_paciente,identificacion,aseguradora,procedimiento,profesional_nombre,ubicacion,hora_inicial,hora_final}` |
| `reason` | `nombre_paciente` o `'Bloqueo iSalud'` | `LINA MARIA OTALORA TOVAR` |
| `notes` | template con todos los campos | `[iSalud] LINA... \| consulta... \| COLSANITAS... \| JUAN...` |
| `payment_type` | **`'Particular'`** (hardcoded en algún lado — verificar) | `Particular` |
| `synced_at` | NOW() del momento del sync | `2026-05-29T10:32:11Z` |
| `consultation_type_id` | **NULL** (sin mapping) | — |
| `res256_category` | (campo no existe en appointments, lo lleva el consultation_type) | n/a |

Tabla `patients`: **NO SE CREAN registros para pacientes iSalud.** El sync NUNCA escribe a `patients`. Los 498 appointments tienen `patient_id = NULL`.

Tabla `doctors`: el sync crea/actualiza doctores via `getOrCreateDoctor` (sync-agent.ts:140-180). Mapping iSalud→Omuwan vía `doctor_external_mappings`.

### 3.4 Lo que NO se parsea (gaps)

| Dato en external_data | Estado actual | Lo que necesita Res-256 |
|---|---|---|
| `identificacion: "CC 36306619"` | string crudo | split a `document_type='CC'` + `document_number='36306619'` en patients |
| `nombre_paciente: "LINA MARIA OTALORA TOVAR"` | un solo campo | split a `first_name='Lina'`, `middle_name='María'`, `first_last_name='Otalora'`, `second_last_name='Tovar'` |
| `aseguradora: "COLSANITAS<basura>"` | string contaminado con régimen+tipo | parse a `eapb_code='PRE001'` (usar findEapbCodeByName + cleanup) |
| `procedimiento: "consulta de primera vez por especialista en ginecologia y obstericia"` | string libre | mapeo a `res256_category='Ginecología'` via `suggestRes256Category` heurística |
| `fecha + hora_inicial` (asignación de cita en iSalud) | `appointment.starts_at` ✅ | `fecha_asignacion` Res-256 ✅ ya está |

### 3.5 Datos que iSalud probablemente tiene pero el sync NO navega

- **birth_date**: directorio `/pacientes` lo muestra
- **gender** (M/F): idem
- **email** del paciente: idem
- **fecha de solicitud de cita** (`requested_at`): podría estar en módulo `/agendamiento` o como columna oculta de `/admision`. Hoy NO se sabe si existe expuesto en la UI
- **fecha deseada** (`desired_at`): probablemente NO existe en iSalud — es un campo que solo capturamos cuando el agente WhatsApp captura la preferencia del paciente

---

## 4. Gaps específicos para Res-256

Para que las 498 citas iSalud entren en el reporte, necesitamos cubrir los siguientes campos. Marqué cuál se puede inferir del `external_data` actual vs cuál requiere navegar a más páginas de iSalud:

| Columna Res-256 | ¿Se puede inferir de external_data hoy? | Acción recomendada |
|---|---|---|
| IDENTIFICACION (CC/TI/etc.) | ✅ split `identificacion` | implementar parser en sync |
| NUMERO | ✅ split `identificacion` | idem |
| FECHA NACIMIENTO | ❌ no está | scrape `/pacientes` |
| GENERO | ❌ no está | scrape `/pacientes` |
| PRIMER NOMBRE | ⚠️ heurístico desde `nombre_paciente` (4 palabras uppercase) | parser con fallback a "primera palabra" |
| SEGUNDO NOMBRE | ⚠️ idem (puede estar vacío si solo 3 palabras) | idem |
| PRIMER APELLIDO | ⚠️ idem (palabra 3 si hay 4 totales, palabra 2 si hay 3) | idem |
| SEGUNDO APELLIDO | ⚠️ idem (palabra 4 si hay 4 totales) | idem; **falla con apellidos compuestos** ("DE LA CRUZ") |
| CODIGO EAPB | ⚠️ parsear `aseguradora` quitando "Régimen:...Tipo afiliado:..." | usar regex `^([A-ZÁÉÍÓÚÑ ]+?)(?:Régimen|$)` + `findEapbCodeByName` |
| FECHA SOLICITUD CITA | ❌ no en external_data | **decisión**: usar `fecha` como fallback OR scrape otra página OR dejar NULL |
| FECHA ASIGNACION | ✅ `fecha` (= `starts_at` date) | ya OK |
| FECHA DESEADA | ❌ no en external_data ni en iSalud probablemente | **decisión**: usar `fecha_asignacion` como fallback o dejar vacío |

Además, hace falta:
- **Clasificación de `consultation_type`**: `procedimiento` (free-text) → `res256_category`. La heurística `suggestRes256Category` ya cubre los casos comunes (ginecología, ecografía, etc.). Las citas iSalud NO tienen `consultation_type_id` — habría que crear consultation_types nuevos o vincular las citas a categorías directamente.

---

## 5. Recomendaciones para Fase 2

### 5.1 Antes de tocar el código del sync

1. **Investigar la causa del crash desde 21 abril.** Sospecho H1 (creds rotadas) o H2 (timeout). Mirar dashboard de Vercel → Functions → `/api/sync/isalud` → últimos invocations + duración + errores. Probar login manual con las creds que están en DB.
2. **Resetear sync_status**: `UPDATE sync_integrations SET sync_status='idle', sync_error=NULL WHERE clinic_id='<algia>'` antes de re-arrancar el cron. (No es estrictamente necesario porque el código no chequea el status antes de arrancar, pero deja la observabilidad limpia.)
3. **Probar `force_sync` manual** desde el dashboard antes de esperar el cron. La acción ya existe en `route.ts` línea ~54.

### 5.2 Plan de mejoras al sync (estimación bruta)

| Mejora | Esfuerzo | Justificación |
|---|---|---|
| Parser `splitIdentificacion(raw)` → `{document_type, document_number}` | 0.5h | Reutiliza en upsertBlockedAppointments + tests |
| Parser `splitName(raw)` → `{first_name, middle_name, first_last_name, second_last_name}` | 1.5h | Heurística + tests con apellidos compuestos del catálogo Algia |
| Parser `cleanAseguradora(raw)` → string limpio para `findEapbCodeByName` | 0.5h | Regex para quitar "Régimen:...Tipo afiliado:..." |
| Crear/buscar `patients` por `(clinic_id, document_number)` y vincular `patient_id` | 2h | Si el documento no existe → crear paciente con datos parciales. Si existe → reusar. |
| Heurística `procedimiento` → `consultation_type_id` o `res256_category` directo en appointment | 2h | Reutiliza `suggestRes256Category`. Decisión arquitectónica: ¿guardar la categoría en una columna nueva `appointments.res256_category` o forzar `consultation_type_id`? |
| Scraper de `/pacientes` para `birth_date` + `gender` + `email` | 4h | Asume que iSalud tiene un directorio paginable. Probar manualmente primero qué hay en `/pacientes` |
| Mapeo de `requested_at`: usar `min(synced_at, starts_at - 1 day)` como fallback | 1h | Aceptar que iSalud no expone fecha de solicitud separada |
| Tests integrales del parser + del sync con fixtures de external_data reales | 2h | Reutilizar los 2 ejemplos que ya conozco (LINA MARIA + ANA MILENA) |
| Reset + re-run sync completo de Algia | 1h | Borrar 498 citas + relanzar import |
| **Total estimado** | **~14.5h** | ≈ 2 días de trabajo focused |

### 5.3 Decisiones arquitectónicas que necesitan tu OK

1. **¿Crear `patients` al importar de iSalud?**
   - Pro: vínculo directo `appointment.patient_id`, datos demográficos en un solo lugar
   - Con: 498 nuevos pacientes que pueden duplicarse con pacientes que ya chatean por WhatsApp con la misma cédula (necesita lógica de merge por `document_number`)

2. **`res256_category` en appointments O via consultation_types?**
   - Hoy `consultation_types` tiene la categoría — pero las citas iSalud no tienen `consultation_type_id`
   - Opciones: (a) crear consultation_types ficticios "Consulta iSalud Gineco" y clasificarlos, o (b) agregar columna `appointments.res256_category` para override directo en citas iSalud. **Recomiendo (b)** — menos basura en consultation_types.

3. **`requested_at` para citas iSalud**: ¿`starts_at - 1 día`, `synced_at`, o `NULL`?
   - Por la regulación, fecha_solicitud es lo más importante para medir "oportunidad". Si la dejamos NULL, esas citas van a "Incompletas".
   - **Recomiendo `NULL` y dejar que Lady decida caso por caso** vía `appointment_res256_complement` (la tabla que planeamos en Fase 2).

4. **Encoding y nombres**: iSalud devuelve nombres en UPPERCASE (`LINA MARIA OTALORA TOVAR`). El form de Algia usa Title Case. Decidir si normalizar a Title Case en el sync o dejarlo crudo. PISIS acepta ambos.

### 5.4 Riesgos no obvios

- **R1**: Si re-arrancamos el sync hoy, iSalud va a importar citas hasta el 7 agosto (60 días). Pero las citas viejas que ya están en DB no se "actualizan retroactivamente" con los nuevos parsers. Habrá que: (a) borrar y re-importar todo, o (b) hacer un script de migración que pase los `external_data` ya guardados por los parsers nuevos.
- **R2**: El parser de nombres falla con apellidos compuestos comunes en Colombia: "DE LA CRUZ", "DEL PINO", "DE LA HOZ". Mirar el directorio de Algia para ver cuántos casos hay.
- **R3**: iSalud podría haber rotado el password en las credenciales. Hay que validar con Lady antes de tocar código.
- **R4**: Vercel free Function timeout es 60s para serverless funcs sin Vercel Pro. El cron tiene `maxDuration = 300` (5 min) — pero si el plan no es Pro, eso no aplica. **Validar plan actual de Vercel.**

---

## 6. Próximos pasos sugeridos (en orden)

1. **Esperar tus screenshots de iSalud** (mencionaste que los conseguís) — saber exactamente qué páginas tiene + qué muestra `/pacientes`. Eso resuelve qué scrapers nuevos hacen falta.
2. **Verificar credenciales** con Lady — descartar H1.
3. **Mirar dashboard Vercel** para causa del crash desde abril.
4. **Decidir las 4 cuestiones arquitectónicas de §5.3**.
5. **Si todo OK**: arrancar implementación con el bloque de parsers puros (splitIdentificacion, splitName, cleanAseguradora) + tests, antes de tocar el código del scraper.

---

## 7. Lo que NO modifiqué (per tu instrucción)

- ✅ Cero cambios en `src/lib/isalud/`
- ✅ Cero cambios en `sync_integrations` table
- ✅ Cero cambios en `appointments` table
- ✅ No reseté `sync_status='running'` (queda para que vos decidas)
- ✅ No forcé un sync manual

Solo lectura: queries de auditoría a DB + curl a `algia.isalud.co` para validar form structure.
