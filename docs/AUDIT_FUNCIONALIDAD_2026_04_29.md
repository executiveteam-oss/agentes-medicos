# Audit Tecnico de Funcionalidad — Omuwan
**Fecha:** 2026-04-29
**Alcance:** Codigo completo (agente, crones, webhooks, server actions, DB, config)
**Exclusiones:** CSS/estilos, documentacion, tests, i18n

---

## 1. RESUMEN EJECUTIVO

| Severidad | Cantidad |
|-----------|----------|
| P0 (bloqueador) | 5 |
| P1 (alto) | 12 |
| P2 (medio) | 16 |
| P3 (bajo) | 9 |
| **Total** | **42** |

**Top 3 riesgos criticos:**
1. **Double-booking**: sin transaccion atomica entre check de conflicto e INSERT de cita, dos pacientes pueden quedar en el mismo slot
2. **Recordatorios 100% free-form**: todas las notificaciones proactivas fallan silenciosamente fuera de ventana 24h de Meta (error 131047)
3. **Race condition en confirmacion de recordatorio**: cron puede sobreescribir `reminder_confirmed=true` del paciente con `false`

---

## 2. HALLAZGOS

### P0-01 — Double-booking por falta de transaccion
- **Categoria:** Bug funcional / Race condition
- **Archivo:** `src/agents/tools/executor.ts:510-613`
- **Problema:** `check_availability` verifica conflictos (linea 519), luego INSERT de cita (linea 613). Entre ambas operaciones no hay transaccion ni lock. Dos requests concurrentes pueden pasar el check y crear dos citas en el mismo slot.
- **Reproduccion:** Dos pacientes agendan la misma hora simultaneamente por WhatsApp.
- **Riesgo:** Citas duplicadas en produccion. Doctor ve 2 pacientes en el mismo horario.
- **Esfuerzo:** M — agregar UNIQUE constraint parcial en `(doctor_id, starts_at) WHERE status NOT IN ('cancelled')` o usar SELECT FOR UPDATE.

### P0-02 — Webhook sin idempotencia: mensajes duplicados
- **Categoria:** Bug funcional / Race condition
- **Archivo:** `src/app/api/webhooks/whatsapp/route.ts:147-261`
- **Problema:** Meta reintenta webhooks si recibe 5xx o timeout. No hay check de `whatsapp_message_id` antes de procesar. El mismo mensaje se procesa N veces, generando respuestas duplicadas y potencialmente citas duplicadas.
- **Reproduccion:** Si el webhook tarda >30s (timeout Vercel), Meta reenvia.
- **Riesgo:** Paciente recibe 2-3 respuestas identicas. Posible double-booking.
- **Esfuerzo:** S — agregar UNIQUE constraint en `messages(conversation_id, whatsapp_message_id)` y check antes de procesar.

### P0-03 — Recordatorios proactivos fallan silenciosamente (ventana 24h)
- **Categoria:** Bug funcional
- **Archivos:** `src/app/api/cron/send-reminders/route.ts` (todas las funciones de envio), `src/lib/cancel-notify.ts:80-87`, `src/app/api/cron/post-consulta/route.ts:90-94`, `src/app/api/cron/reactivacion/route.ts:110-127`
- **Problema:** Todas las notificaciones proactivas a pacientes usan free-form text (`sendWhatsAppMessage`), nunca WhatsApp templates. Para pacientes que no han escrito en 24h, Meta retorna error 131047 y el mensaje no llega. El sistema loggea el error pero no registra el fallo en DB ni notifica al staff.
- **Riesgo:** ~40% de recordatorios no llegan. Staff asume que todos los pacientes fueron notificados. No-shows que podrian haberse evitado.
- **Esfuerzo:** L — requiere crear templates en Meta Business Manager (proceso de aprobacion de 1-3 dias), implementar `sendWhatsAppTemplate()`, y usar template como fallback cuando free-form falla.

### P0-04 — Cron sobreescribe confirmacion de paciente
- **Categoria:** Bug funcional / Race condition
- **Archivo:** `src/app/api/cron/send-reminders/route.ts:436-460`
- **Problema:** `markUnconfirmedAppointments()` selecciona citas con `reminder_confirmed IS NULL` y `updated_at <= 12h ago`, luego hace UPDATE `reminder_confirmed = false`. Si el paciente confirma entre el SELECT y el UPDATE, su confirmacion se pierde.
- **Reproduccion:** Paciente responde "Si" al recordatorio justo cuando el cron ejecuta.
- **Riesgo:** Paciente confirmado aparece como "no confirmo". Morning report muestra semaforo amarillo/rojo incorrecto.
- **Esfuerzo:** XS — agregar `.is('reminder_confirmed', null)` al UPDATE WHERE clause.

### P0-05 — Fallos de recordatorio no se registran en DB
- **Categoria:** Bug funcional
- **Archivo:** `src/app/api/cron/send-reminders/route.ts:188-190, 299-300, 419-420`
- **Problema:** Cuando `sendWhatsAppMessage()` retorna null (fallo), el cron solo incrementa un counter local y loggea. No inserta en tabla `reminders` con `status='failed'`. No hay forma de saber que pacientes NO fueron notificados.
- **Riesgo:** Sin tracking, imposible auditar la tasa de entrega. Staff no puede llamar manualmente a pacientes no notificados.
- **Esfuerzo:** S — insertar en `reminders` con `status: 'failed'` en el bloque else de cada funcion de envio.

---

### P1-01 — Missing clinic_id en queries secundarias (multi-tenant leak)
- **Categoria:** Security
- **Archivo:** `src/app/actions/appointments.ts:71, 78, 84, 199, 205`
- **Problema:** Despues de validar una cita con `clinic_id`, queries secundarias a `patients` para actualizar `no_show_count` y `total_appointments` no filtran por `clinic_id`. Un atacante podria manipular `patient_id` para modificar contadores de otra clinica.
- **Riesgo:** Modificacion de datos cross-tenant. Bajo en practica (requiere UUID valido de otro tenant).
- **Esfuerzo:** XS — agregar `.eq('clinic_id', clinicId)` a 5 queries.

### P1-02 — N+1 queries en cron de recordatorios
- **Categoria:** Performance
- **Archivo:** `src/app/api/cron/send-reminders/route.ts:167, 275, 400, 525, 597`
- **Problema:** `getClinicCreds()` se llama por cada cita individual. 100 citas = 100 queries para obtener credenciales WhatsApp que son las mismas para toda la clinica.
- **Riesgo:** Timeout de Vercel (30s) si hay muchas citas. Cron no termina, Meta reintenta.
- **Esfuerzo:** S — cargar credenciales una vez al inicio, pasar como Map a cada funcion.

### P1-03 — Tool inputs del agente sin validacion
- **Categoria:** Security / Bug funcional
- **Archivo:** `src/agents/tools/executor.ts:55-75`
- **Problema:** `toolUse.input` de Claude se castea a `Record<string, unknown>` sin validar campos requeridos. Si Claude envia input malformado (campo faltante o tipo incorrecto), la ejecucion falla con error generico que Claude no puede interpretar.
- **Riesgo:** Agente da respuesta confusa al paciente ("estoy teniendo dificultades").
- **Esfuerzo:** M — agregar Zod schemas para validar input de cada tool antes de ejecutar.

### P1-04 — Morning report falla serialmente por clinica
- **Categoria:** Bug funcional
- **Archivo:** `src/app/api/cron/morning-report/route.ts:48-50`
- **Problema:** Loop serial `for (const clinic of clinics)`. Si clinica 3 falla, clinicas 4-N nunca reciben su reporte. No hay try/catch por clinica.
- **Riesgo:** Un error en una clinica bloquea reportes de todas las demas.
- **Esfuerzo:** XS — envolver en try/catch individual por clinica.

### P1-05 — Rate limiter inefectivo en produccion serverless
- **Categoria:** Security
- **Archivos:** `src/lib/rate-limit.ts:44-49, 136-147`
- **Problema:** `checkRateLimit()` (sync) usa in-memory store por defecto. En Vercel con multiples instancias, cada una tiene su propio store. Upstash es fire-and-forget (no bloquea). Auth endpoints usan este rate limiter.
- **Riesgo:** Brute-force distribuido contra login sin limite efectivo.
- **Esfuerzo:** M — usar `checkRateLimitAsync()` (que si espera Upstash) para endpoints de auth. Verificar que UPSTASH env vars esten configuradas en Vercel.

### P1-06 — Sync iSalud sin proteccion contra ejecucion concurrente
- **Categoria:** Race condition
- **Archivo:** `src/app/api/sync/isalud/route.ts:22-25`
- **Problema:** Cron corre cada 30 min. Si el sync tarda >30 min (Playwright + scraping), dos instancias corren simultaneamente, creando duplicados o datos inconsistentes.
- **Riesgo:** Doctores duplicados, citas fantasma.
- **Esfuerzo:** S — check `sync_status = 'running'` antes de iniciar, con timestamp de timeout.

### P1-07 — Timezone incorrecto en reopen-agendas
- **Categoria:** Bug funcional
- **Archivo:** `src/app/api/cron/reopen-agendas/route.ts:19-21`
- **Problema:** Usa `toLocaleString('en-US', { timeZone })` para convertir timezone, luego re-parsea como Date local. Este patron no es confiable — el resultado depende del timezone del servidor, no de Colombia.
- **Riesgo:** Agendas se reabren en el dia incorrecto cerca de medianoche.
- **Esfuerzo:** XS — reemplazar con `nowColombia()` de `src/lib/utils/dates.ts`.

### P1-08 — Input de server actions sin validacion Zod
- **Categoria:** Security / Bug funcional
- **Archivos:** `src/app/actions/appointments.ts:152-154`, `src/app/actions/blocked-dates.ts:97-99`, `src/app/actions/clinic.ts:29-30`
- **Problema:** Validacion manual con if/else en lugar de Zod schemas. No valida tipos, rangos, formatos de fecha, UUIDs. Un `duration_minutes` negativo o un `starts_at` con formato invalido pasan sin error.
- **Riesgo:** Datos corruptos en DB. Errores confusos para el usuario.
- **Esfuerzo:** M — crear schemas Zod para las 10+ server actions principales.

### P1-09 — Error handling del agente no protege contra null response
- **Categoria:** Bug funcional
- **Archivo:** `src/app/api/webhooks/whatsapp/route.ts:357-401`
- **Problema:** Si `runAppointmentAgent()` retorna undefined/null (por ejemplo, timeout de Anthropic API), el codigo siguiente (`agentResponse.text`) crashea. El webhook retorna 500, Meta reintenta, loop infinito.
- **Riesgo:** Paciente nunca recibe respuesta. Meta reintenta indefinidamente.
- **Esfuerzo:** XS — agregar guard `if (!agentResponse)` con mensaje fallback.

### P1-10 — Consentimiento de datos implicito, no explicito
- **Categoria:** Legal / Compliance
- **Archivo:** `src/app/api/webhooks/whatsapp/route.ts:772`
- **Problema:** `data_consent_at` se marca cuando se detecta paciente nuevo, sin que el paciente haya aceptado explicitamente. La Ley 1581/2012 (Colombia) requiere consentimiento explicito para datos sensibles de salud.
- **Riesgo:** Incumplimiento legal. Superintendencia podria sancionar.
- **Esfuerzo:** M — implementar flujo de aceptacion explicita ("Acepto") antes de procesar datos.

### P1-11 — String interpolation en .or() de Supabase
- **Categoria:** Security
- **Archivos:** `src/app/actions/blocked-dates.ts:34`, `src/app/actions/patients.ts:54`
- **Problema:** Variables de usuario interpoladas directamente en strings de filtro PostgREST: `.or(\`name.ilike.%${term}%\`)`. Aunque PostgREST no es vulnerable a SQL injection clasico, caracteres especiales en `term` podrian causar comportamiento inesperado.
- **Riesgo:** Bajo en practica (PostgREST sanitiza), pero patron peligroso.
- **Esfuerzo:** S — sanitizar inputs antes de interpolar.

### P1-12 — Env vars criticas no documentadas en .env.example
- **Categoria:** Consistency / Config
- **Archivo:** `.env.example`
- **Problema:** 4 variables requeridas por el codigo no estan documentadas: `WHATSAPP_APP_SECRET`, `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- **Riesgo:** Nuevo developer o deploy falla sin saber que variable falta.
- **Esfuerzo:** XS — agregar las 4 variables al archivo.

---

### P2-01 — Reminder check truthy en vez de null-check
- **Categoria:** Bug funcional
- **Archivo:** `src/app/api/cron/send-reminders/route.ts:171`
- **Problema:** `if (result)` donde `result` es el message ID de WhatsApp. Si la API retorna string vacio `""`, es truthy en JS — la cita se marca como enviada aunque no lo fue.
- **Esfuerzo:** XS — cambiar a `if (result !== null)`.

### P2-02 — WhatsApp client sin retry logic
- **Categoria:** Deuda tecnica
- **Archivo:** `src/lib/whatsapp/client.ts:57-68`
- **Problema:** Un solo intento de envio. Si Meta tiene un blip de red (comun), mensaje perdido sin reintento.
- **Esfuerzo:** S — agregar retry con backoff exponencial (3 intentos).

### P2-03 — Race condition en post-consulta
- **Categoria:** Race condition
- **Archivo:** `src/app/api/cron/post-consulta/route.ts:66-77`
- **Problema:** Ventana de 23-25h. Si cron corre dos veces en esa ventana, `followup_sent` podria no estar actualizado aun y paciente recibe duplicado.
- **Esfuerzo:** XS — agregar `.eq('followup_sent', false)` al UPDATE.

### P2-04 — Weekly report calcula semana con UTC
- **Categoria:** Bug funcional
- **Archivo:** `src/app/api/cron/weekly-report/route.ts:74-84`
- **Problema:** Usa `getUTCDay()` para calcular "ultimo lunes". Si el cron corre cerca de medianoche UTC, el dia de la semana puede ser incorrecto en contexto Colombia.
- **Esfuerzo:** XS — usar `nowColombia()` para la fecha base.

### P2-05 — Telefono de soporte hardcoded en 5 archivos
- **Categoria:** Consistency / Config
- **Archivos:** `src/app/dashboard/settings/plan/plan-settings-form.tsx:12`, `src/components/dashboard/feature-locked.tsx:12`, `src/app/dashboard/stradmed/page.tsx:25`, `src/components/landing/landing-page.tsx:986,1057`, `src/lib/chatbot/system-prompt.ts:19-20`
- **Problema:** `573015525881` hardcoded. Si cambia, hay que editar 5 archivos.
- **Esfuerzo:** XS — extraer a env var `OMUWAN_SUPPORT_PHONE`.

### P2-06 — URL de fallback hardcoded (dominio viejo)
- **Categoria:** Consistency
- **Archivos:** `src/app/dashboard/settings/whatsapp/whatsapp-setup-wizard.tsx:23`, `src/lib/whatsapp/escalation-notify.ts:72,101`, `src/app/actions/onboarding.ts:105`, `src/app/actions/users.ts:107,251`
- **Problema:** `agentes-medicos-ten.vercel.app` hardcoded como fallback. Deberia ser `omuwan.co` o `NEXT_PUBLIC_APP_URL`.
- **Esfuerzo:** XS — reemplazar con `process.env.NEXT_PUBLIC_APP_URL`.

### P2-07 — Missing permission check en getActiveDoctors
- **Categoria:** Security
- **Archivo:** `src/app/actions/waitlist.ts:341-356`
- **Problema:** Usa `getSessionClinicId()` en vez de `checkReadPermission('espera')`. Un usuario sin permiso de espera puede listar doctores.
- **Esfuerzo:** XS — cambiar a `checkReadPermission`.

### P2-08 — Sanitizacion HTML con regex en vez de parser
- **Categoria:** Security
- **Archivo:** `src/lib/whatsapp/sanitize.ts:22`
- **Problema:** `/<[^>]*>/g` no maneja HTML entities codificados (`&#60;`). Un atacante podria bypassear con entities.
- **Esfuerzo:** S — usar DOMPurify o he.decode() antes del regex.

### P2-09 — 13 tablas sin TypeScript interface
- **Categoria:** Deuda tecnica
- **Archivo:** `src/types/database.ts`
- **Problema:** Tablas como `blocked_dates`, `staff_notifications`, `invitations`, etc. no tienen interface TypeScript. El codigo usa `as Record<string, unknown>` que pierde type safety.
- **Esfuerzo:** M — agregar interfaces para las 13 tablas.

### P2-10 — calculateDailyNoShowRisk duplica queries
- **Categoria:** Performance
- **Archivo:** `src/app/api/cron/morning-report/route.ts:89-91`
- **Problema:** Recalcula probabilidad por cita individual (30 queries), luego `calculateDailyNoShowRisk` re-consulta los mismos pacientes.
- **Esfuerzo:** S — combinar en una sola funcion.

### P2-11 — No hay logging estructurado
- **Categoria:** Deuda tecnica / Observabilidad
- **Archivos:** Todos los crones y webhook
- **Problema:** `console.log` con strings concatenados. Sin timestamps, sin JSON, sin breakdown por clinica. Impossible de monitorear en Vercel.
- **Esfuerzo:** M — migrar a formato JSON con campos estandar.

### P2-12 — Waitlist insert sin UNIQUE constraint
- **Categoria:** Bug funcional
- **Archivo:** `src/app/actions/waitlist.ts:91-116`
- **Problema:** Check de duplicado en codigo, pero sin UNIQUE constraint en DB. Race condition puede crear duplicados.
- **Esfuerzo:** XS — agregar UNIQUE parcial `(clinic_id, patient_id, doctor_id) WHERE status = 'waiting'`.

### P2-13 — free_text_reason sin sanitizar
- **Categoria:** Security
- **Archivo:** `src/agents/tools/executor.ts:628`
- **Problema:** `free_text_reason?.trim()` se guarda directo en DB sin pasar por `sanitizePatientMessage()`.
- **Esfuerzo:** XS — aplicar sanitizacion.

### P2-14 — Nombre de cliente "Algia" en placeholders
- **Categoria:** Consistency
- **Archivos:** `src/app/dashboard/settings/clinic/clinic-settings-form.tsx:456`, `src/components/dashboard/isalud-sync-button.tsx:219`
- **Problema:** Placeholder dice "Algia Clinica" en vez de ejemplo generico.
- **Esfuerzo:** XS.

### P2-15 — Reminders table sin UNIQUE constraint
- **Categoria:** Bug funcional
- **Archivo:** `supabase/migrations/00001_initial_schema.sql`
- **Problema:** No hay UNIQUE en `(appointment_id, type)`. Si cron corre dos veces, puede insertar recordatorio duplicado.
- **Esfuerzo:** XS — agregar constraint.

### P2-16 — Error messages exponen detalles internos en dev
- **Categoria:** Security
- **Archivo:** `src/app/actions/auth.ts:107-109, 168-169, 187-188`
- **Problema:** En `NODE_ENV=development`, errores de Supabase Auth se exponen al usuario. Si development se activa por error en produccion, leak de info.
- **Esfuerzo:** XS — eliminar distincion por env, siempre usar mensaje generico.

---

### P3-01 — Agent max iterations sin feedback a Claude
- **Archivo:** `src/agents/appointment-agent.ts:171-176`
- **Problema:** Si el loop de tools agota 5 iteraciones, retorna fallback generico sin indicar a Claude que se detuvo por limite.
- **Esfuerzo:** XS.

### P3-02 — WhatsApp message truncation edge case
- **Archivo:** `src/lib/whatsapp/client.ts:44-46`
- **Problema:** Trunca a 4090 + "..." = 4093 chars. Edge case si mensaje es exactamente 4093 chars.
- **Esfuerzo:** XS.

### P3-03 — markAsRead sin check de resultado
- **Archivo:** `src/lib/whatsapp/client.ts:108-133`
- **Problema:** No retorna resultado. Si falla, paciente ve mensaje como no leido.
- **Esfuerzo:** XS.

### P3-04 — Magic numbers en ventanas de recordatorio
- **Archivo:** `src/app/api/cron/send-reminders/route.ts:112-114, 209-210, 323-324`
- **Problema:** 71.5, 72.5, 23, 25, 1.5, 2.5 hardcoded. Si se quiere ajustar, hay que editar 5 funciones.
- **Esfuerzo:** XS — extraer a constantes.

### P3-05 — Empty clinic list no se loggea
- **Archivos:** Todos los crones
- **Problema:** Si `clinics` query retorna vacio, el cron no hace nada y no loggea. Podria esconder un problema de DB.
- **Esfuerzo:** XS.

### P3-06 — Cron logs flood con credenciales faltantes
- **Archivo:** `src/app/api/cron/send-reminders/route.ts:168`
- **Problema:** Si una clinica no tiene WhatsApp configurado, loggea una linea por cada cita. 100 citas = 100 lineas identicas.
- **Esfuerzo:** XS — loggear una vez por clinica.

### P3-07 — Weekly report queries 6 meses serialmente
- **Archivo:** `src/app/api/cron/weekly-report/route.ts:33-54`
- **Problema:** 50 clinicas x 6 meses = 300 queries seriales.
- **Esfuerzo:** S — usar Promise.all por clinica.

### P3-08 — Google Sheets sync fire-and-forget
- **Archivo:** `src/agents/tools/executor.ts:657-667`
- **Problema:** Si sync falla, la cita ya fue confirmada al paciente. Sistemas downstream quedan desactualizados.
- **Esfuerzo:** S — queue con retry.

### P3-09 — NPS response window de 48h demasiado amplia
- **Archivo:** `src/app/api/webhooks/whatsapp/route.ts:924`
- **Problema:** Paciente podria responder a un NPS viejo si tiene multiples citas en 48h.
- **Esfuerzo:** XS — reducir a 24h y validar appointment_id.

---

## 3. TOP 5 P0/P1 A ARREGLAR PRIMERO

| # | Hallazgo | Esfuerzo | Horas est. |
|---|----------|----------|------------|
| 1 | **P0-02**: Webhook idempotencia (UNIQUE en whatsapp_message_id + check antes de procesar) | S | 2h |
| 2 | **P0-04**: Cron sobreescribe confirmacion (agregar `.is('reminder_confirmed', null)` al UPDATE) | XS | 0.5h |
| 3 | **P0-05**: Registrar fallos de recordatorio en DB (insertar con `status: 'failed'`) | S | 1.5h |
| 4 | **P0-01**: Double-booking (UNIQUE constraint parcial + transaccion) | M | 3h |
| 5 | **P1-01**: clinic_id en queries secundarias (5 lineas) | XS | 0.5h |

**Total estimado Top 5: ~7.5h**

Los fixes 2, 3 y 5 son cambios de 1-5 lineas cada uno. El fix 1 requiere migracion + check en webhook. El fix 4 es el mas complejo (constraint + refactor de executor.ts).

P0-03 (templates WhatsApp) es el de mayor impacto real pero requiere aprobacion de Meta (1-3 dias), asi que se planifica aparte como sprint dedicado.
