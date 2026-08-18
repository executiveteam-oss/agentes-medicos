# Audit de Features Mencionadas en Landing

**Fecha:** 2026-05-05

---

## FEATURE 1: Lista de Espera (Waitlist)

### Status: FUNCIONA PARCIAL

### Qué hace

El sistema tiene 2 flujos:
1. **Dashboard manual:** Staff agrega pacientes a lista de espera desde `/dashboard/espera`
2. **Agente WhatsApp:** Cuando no hay disponibilidad, el agente ofrece `add_to_waitlist`

Cuando se cancela una cita:
- **Vía agente:** Notifica al primer paciente en espera (FIFO) — `executor.ts:1139-1188`
- **Vía dashboard:** Notifica al paciente con mayor prioridad (scoring) — `priority.ts:213-309`

### Evidencia en producción

```
Total entries: 4
  waiting: 3
  notified: 1 (Natalia Rendón, 12 mar 2026)
  booked: 0

Todas creadas desde dashboard (source='dashboard')
Todas para Dra. Carolina Montoya
Ninguna creada vía agente WhatsApp
```

### Qué funciona

| Aspecto | Status |
|---------|--------|
| Dashboard: agregar paciente | ✅ Funciona (4 entries reales) |
| Dashboard: notificar manualmente | ✅ Funciona (1 notificada) |
| Agente: ofrecer lista de espera | ✅ Tool `add_to_waitlist` definida y conectada |
| Auto-notificación al cancelar (agente) | ✅ Código existe, FIFO ordering |
| Auto-notificación al cancelar (dashboard) | ✅ Código existe, priority scoring |
| UI para ver la lista | ✅ `/dashboard/espera` |
| Priorización por score | ✅ payment + frequency + no-shows + days waiting |

### Qué NO funciona o tiene riesgo

| Problema | Severidad | Detalle |
|----------|-----------|---------|
| Notificación WhatsApp es free-form | Alta | Si paciente no escribió en 24h, el mensaje no llega. No usa templates. |
| Auto-notify del agente no crea pending_contact | Media | Si el WhatsApp falla, nadie se entera (a diferencia del dashboard que sí crea pending_contact) |
| Inconsistencia FIFO vs Priority | Baja | Agente usa FIFO, dashboard usa scoring. Podrían notificar a pacientes distintos. |
| 0 entries vía agente | Info | Las 4 entries son manuales. El flujo del agente no ha sido probado en producción con pacientes reales. |

### Recomendación

**MANTENER EN LANDING.** La feature existe, funciona end-to-end (manual + agente), tiene datos reales en producción. Los riesgos (ventana 24h, inconsistencia FIFO/priority) son de calidad, no de existencia.

**Fix recomendado (2h):**
- Agregar pending_contact cuando auto-notify del agente falla
- Unificar scoring (usar priority en ambos flujos)

---

## FEATURE 2: Reportes Semanales Automáticos

### Status: NO FUNCIONA EN PRODUCCIÓN

### Qué hace

Cron que corre cada lunes 8:00 AM Colombia (`vercel.json: "0 13 * * 1"`):
1. Calcula métricas de la semana anterior (citas completadas, no-shows, ingresos, pacientes nuevos)
2. Envía reporte por WhatsApp al admin de cada clínica
3. Incluye alerta si tasa de no-shows > 20%

**Archivo:** `src/app/api/cron/weekly-report/route.ts` (188 líneas)

### Evidencia en producción

```
Audit log entries para 'weekly_report_sent': 0
```

El cron **nunca se ha ejecutado exitosamente** (o nunca registró ejecución en audit_log).

### Por qué no funciona

| Requisito | ALGIA | Resultado |
|-----------|-------|-----------|
| subscription_status = trial/active | ✅ | OK |
| weekly_report = true | ✅ (default) | OK |
| >= 10 appointments | ✅ (498) | OK |
| escalation_contact_phone o phone | ❌ **NULL** | **BLOQUEANTE** |
| WhatsApp credentials | ✅ | OK |

**Root cause:** ALGIA no tiene `escalation_contact_phone` configurado. El cron busca ese campo primero, luego `clinic.phone` como fallback. Ambos son NULL para ALGIA → el cron skippea la clínica silenciosamente.

**Código relevante** (`route.ts:153-155`):
```typescript
const adminPhone = (clinic.escalation_contact_phone || clinic.phone || '').trim()
if (!adminPhone) { skipped++; continue }
```

### Qué funciona (en código)

| Aspecto | Status |
|---------|--------|
| Cron schedule en Vercel | ✅ Configurado (lunes 8 AM COL) |
| Cálculo de métricas | ✅ Código correcto |
| Formato del mensaje | ✅ Con emojis, alerta de no-show |
| UI para habilitar/deshabilitar | ✅ Settings > Notificaciones |
| Envío por WhatsApp | ✅ Código existe |

### Qué NO funciona

| Problema | Severidad | Detalle |
|----------|-----------|---------|
| ALGIA sin teléfono de admin | **Bloqueante** | `escalation_contact_phone` y `phone` ambos NULL |
| 0 ejecuciones exitosas | Bloqueante | Nunca se envió un reporte |
| No hay UI para ver reportes pasados | Baja | Solo viven en WhatsApp del destinatario |
| No se registra en audit_log | Media | No hay forma de saber si el cron corrió o no |

### Recomendación

**QUITAR DE LANDING hasta que funcione.** Ya lo quitamos del plan Equipo.

**Fix para que funcione (1h):**
1. Configurar `escalation_contact_phone` o `phone` en ALGIA
2. Verificar que el cron corre el próximo lunes
3. Agregar audit_log entry para tracking
4. Una vez confirmado que llega, volver a agregar a la landing

---

## RESUMEN

| Feature | Status | Landing | Esfuerzo para fix |
|---------|--------|---------|-------------------|
| Lista de espera | **FUNCIONA PARCIAL** | Puede volver | 2h (pending_contact + unificar scoring) |
| Reportes semanales | **NO FUNCIONA** | Queda fuera | 1h (configurar teléfono + verificar cron) |
