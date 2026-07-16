# Cableado de templates de recordatorio + cancelación — Plan para sesión de implementación

**Fecha:** 2026-07-16
**Estado:** Plan preparado, NO ejecutado. Para correr en paralelo mientras Meta revisa los templates (24-72h).

---

## Contexto

Hallazgo del audit de flujos salientes (2026-07-16): **todo mensaje que INICIA la conversación fuera de la ventana de 24h de WhatsApp necesita un template aprobado.** Hoy los recordatorios, la cancelación y la lista de espera mandan **texto libre** (`sendWhatsAppMessage`), que falla en silencio con code 131047 cuando la paciente está fuera de ventana — que es la mayoría (agendaron hace días, no escribieron desde entonces). El mensaje nunca llega, el cron no marca `_sent` (es defensivo) y reintenta sin éxito. El anti-no-show (core del producto) está efectivamente roto para casi todos los pacientes.

`sendWhatsAppTemplate` ya existe (`src/lib/whatsapp/client.ts`, se construyó para la encuesta). Falta: (a) aprobar los templates en Meta, (b) cablear el código para usarlos.

**Templates sometidos a Meta (2026-07-16), esperando aprobación:**

### `recordatorio_cita` — UTILITY, Spanish (COL), 5 variables
Body:
```
Hola {{1}} 👋 Te recordamos tu cita con {{2}} el {{3}} a las {{4}}.
📍 {{5}}
Te esperamos.
```
> **Nota Meta:** el `Te esperamos.` final es obligatorio — Meta rechaza variables al inicio o al final del body, y sin esa línea `{{5}}` quedaba último. `{{1}}` al inicio está OK porque lo precede `Hola `.
- `{{1}}` nombre · `{{2}}` doctor · `{{3}}` cuándo · `{{4}}` hora · `{{5}}` dirección
- Botones Quick Reply: `Confirmar` · `Reagendar` · `Cancelar`
- Un solo template para las 3 tandas (72h/24h/2h). Cambia solo `{{3}}`: "el viernes 18 de julio" / "mañana miércoles 16 de julio" / "hoy".

### `cancelacion_cita` — UTILITY, Spanish (COL), 5 variables
Body:
```
Hola {{1}} 👋 Lamentamos informarte que tu cita con {{2}} del {{3}} a las {{4}} fue cancelada {{5}}. Queremos reagendarte lo antes posible.
```
- `{{1}}` nombre · `{{2}}` doctor · `{{3}}` fecha · `{{4}}` hora · `{{5}}` motivo (nunca vacío — el código ya pone default "por motivos del consultorio")
- Botón Quick Reply: `Reagendar`
- Los "próximos 3 cupos" NO van en el template (texto dinámico multilínea); se ofrecen en la conversación cuando la paciente toca "Reagendar".

**Decisión tomada:** el `📄 Recuerda traer: {docs}` del recordatorio 24h queda FUERA (Meta no permite variables vacías, y ningún CT de Algia usa `requires_documents` hoy — verificado en prod, 0 filas). Si algún día Algia lo prende, se agrega `{{6}}` con default no-vacío.

**Ya aplicado (commit aparte):** línea en `system-prompt.ts` para que el agente anuncie el `.ics` al confirmar. Pendiente de deploy.

---

## ⚠️ Orden crítico — Tarea 3 ANTES de migrar el número

Si Meta aprueba y el cron empieza a mandar recordatorios **con botones** pero el handler de `type:'button'` NO está listo, la paciente toca "Confirmar" y **no pasa nada** — peor que no tener botón. Hoy no muerde porque el número no está migrado (no hay pacientes reales). **La Tarea 3 es bloqueante de la migración del número.**

**Sumar al checklist "agente listo para migrar el número":**
- [ ] Reglas de Fase 1 configuradas (colposcopia, histeroscopias, sedación, ginecología edad+embarazo)
- [ ] Campana de escalación in-app (ya deployada — verificación visual de Task 8 pendiente)
- [ ] **Tarea 3 de este plan: handler de Quick Reply funcionando**

---

## Tareas

### Tarea 1 — Constantes de template + snapshot tests
- Definir `REMINDER_TEMPLATE_NAME = 'recordatorio_cita'`, `CANCEL_TEMPLATE_NAME = 'cancelacion_cita'`, `LANGUAGE_CODE = 'es_CO'` (ya existe en el cron de encuesta) y los textos congelados.
- Snapshot tests (mismo patrón que `test-survey-template-snapshot.ts`): congelar body + botones + nombre + límites Meta, para que nadie edite el wording sin re-aprobar en Meta.
- Modelo idéntico a la encuesta: nombre compartido, cada clínica aprueba su propio template con ese nombre exacto.

### Tarea 2 — Cron `send-reminders` → `sendWhatsAppTemplate`
Archivo: `src/app/api/cron/send-reminders/route.ts` (3 sends: ~178 [72h], ~305 [24h], ~450 [2h]).
- Reemplazar los 3 `sendWhatsAppMessage` por `sendWhatsAppTemplate` con `recordatorio_cita`.
- Params `[nombre, doctor, cuándo, hora, dirección]`. El "cuándo" (`{{3}}`) es lo único que cambia por tanda.
- Sale el append `📄 Recuerda traer` (moot en Algia).
- El 24h ya no arma el texto de confirmación SÍ/NO/CAMBIAR — eso pasa a ser los botones del template.
- **Gating: intentar-y-fallar-elegante, SIN flag nuevo.** Si el template no está aprobado, `sendWhatsAppTemplate` falla con 132001 → null → no marca `_sent` → reintenta (comportamiento de hoy). En cuanto Meta aprueba, los recordatorios empiezan a salir solos sin tocar nada.
- Mantener el guard `if (result !== null)` antes de marcar `reminder_*_sent = true` (ya existe, es correcto).

### Tarea 3 — Handler de Quick Reply (BLOQUEANTE de migración)
Archivo: `src/app/api/webhooks/whatsapp/route.ts`.
- Los botones Quick Reply de un template devuelven un mensaje `type: 'button'` en el webhook (no `type: 'text'`). El webhook hoy no procesa ese tipo.
- Reconocer `type: 'button'`, extraer el texto/payload del botón (`Confirmar` / `Reagendar` / `Cancelar`), y mapearlo al `handleReminderResponse` existente (que hoy parsea "sí/no/cambiar").
- Verificar que la respuesta del botón abre la ventana de 24h (lo hace — es un mensaje entrante de la paciente) para que el agente pueda responder por texto libre (ej. ofrecer cupos tras "Reagendar").

### Tarea 4 — `cancelAndNotifyPatient` → template + fix `priority.ts`
- `src/lib/cancel-notify.ts` (~82): `cancelAndNotifyPatient` → `sendWhatsAppTemplate` con `cancelacion_cita`, params `[nombre, doctor, fecha, hora, motivo]`. Los cupos salen del mensaje; se ofrecen en conversación tras "Reagendar".
- `src/app/actions/priority.ts:286`: fix del `getClinicCreds` faltante (hoy `sendWhatsAppMessage(phone, mensaje)` sin 3er arg → cae al fallback global multi-tenant, número equivocado). **Salvedad:** como la lista de espera NO tiene template (se salteó `cupo_disponible`), arreglar solo las creds no la hace funcionar fuera de ventana. Queda incompleta a propósito — el fix de creds sirve solo para envíos dentro de ventana.

---

## Pendientes post-piloto (anotados, NO en este plan)

- **Lista de espera** — necesita su propio template (`cupo_disponible`) + el fix de `priority.ts`. Queda incompleta a propósito: raro que se dispare y `priority.ts` está roto (sin creds). Retomar cuando sea prioridad.
- **Flujos a staff en ventana 24h** — `morning-report` y `weekly-report` (a Lady) mandan texto libre y también fallan con 131047 si el destinatario no escribió al número en 24h. Es la misma clase de bug pero a staff, no a pacientes. Otra tanda.
- **`{{6}}` de docs** — si algún día Algia prende `requires_documents` para algún procedimiento, agregar `{{6}}` al `recordatorio_cita` con default no-vacío ("tu documento de identidad") y re-someter a Meta.

---

## Bugs anotados (no de ventana 24h)

1. `priority.ts:286` — lista de espera sin `clinicCreds` (multi-tenant). Fix en Tarea 4.
2. Flujos a staff caen en ventana 24h — post-piloto arriba.
