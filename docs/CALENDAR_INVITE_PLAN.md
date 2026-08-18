# Calendar Invite (.ics) — Plan de Implementacion

**Fecha:** 2026-04-30
**Objetivo:** Enviar archivo .ics al paciente cuando el agente confirma o reagenda una cita.

---

## 1. ARCHIVOS A CREAR/MODIFICAR

| Archivo | Accion | Lineas est. |
|---------|--------|-------------|
| `src/lib/calendar/generate-ics.ts` | Crear | ~80 |
| `src/lib/whatsapp/client.ts` | Modificar | +40 (sendWhatsAppDocument) |
| `src/agents/appointment-agent.ts` | Modificar | +15 (extender AgentResponse) |
| `src/app/api/webhooks/whatsapp/route.ts` | Modificar | +30 (hook post-confirmacion) |
| `package.json` | Modificar | +1 (dep ics) |

**Total: 1 archivo nuevo, 4 modificados, ~165 lineas nuevas.**

### Decisiones de arquitectura

**Sin Supabase Storage.** En vez de subir el .ics a un bucket y mandar URL:
- Generamos el .ics como string en memoria
- Lo convertimos a base64
- Lo enviamos via WhatsApp API con `type: 'document'` y campo `data` (base64) en vez de `link`

Razones:
- Evita crear bucket, politicas, URLs publicas, lifecycle, latencia de upload
- El .ics es <2KB — trivial en base64
- WhatsApp API soporta media inline via base64 (max 100MB para documentos)
- Sin dependencia de Storage = menos superficie de fallo
- Sin URLs publicas expuestas

**Sin migracion.** No se necesita tabla ni columna nueva. El .ics se genera on-the-fly desde datos ya disponibles.

---

## 2. LIBRERIA DE GENERACION

**Paquete:** `ics` v3.12.0

| Criterio | Resultado |
|----------|-----------|
| Tamano | ~25 archivos, lightweight |
| Tipos TypeScript | Si (index.d.ts incluido) |
| VALARM | Si — soporta multiples alarmas con `alarms[]` |
| Compatibilidad Next.js 16 | Si — es puro JS, sin dependencias nativas |
| Licencia | ISC |

---

## 3. SCHEMA DEL .ICS GENERADO

Ejemplo para cita tipica:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Omuwan//Cita Medica//ES
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
UID:550e8400-e29b-41d4-a716-446655440000@omuwan.co
DTSTART;TZID=America/Bogota:20260505T090000
DTEND;TZID=America/Bogota:20260505T093000
SUMMARY:Cita: Terapia piso pelvico — Dra. Gonzalez
LOCATION:Cl 12 #34-56\, Pereira
DESCRIPTION:Cita medica con Dra. Gonzalez\nTerapia piso pelvico\n\nSi
  necesitas cambiar tu cita\, escribenos por WhatsApp.
STATUS:CONFIRMED
SEQUENCE:0
BEGIN:VALARM
TRIGGER:-P1D
ACTION:DISPLAY
DESCRIPTION:Cita manana: Terapia piso pelvico con Dra. Gonzalez
END:VALARM
BEGIN:VALARM
TRIGGER:-PT1H
ACTION:DISPLAY
DESCRIPTION:Cita en 1 hora: Terapia piso pelvico con Dra. Gonzalez
END:VALARM
END:VEVENT
END:VCALENDAR
```

**Campos clave:**
- `UID`: `{appointment.id}@omuwan.co` — unico, persiste en reagendamientos
- `DTSTART/DTEND`: timezone America/Bogota (no UTC)
- `SUMMARY`: "Cita: {tipo} — {doctor}" o "Cita medica — {doctor}" si no hay tipo
- `LOCATION`: direccion de la clinica (omitido si virtual)
- `DESCRIPTION`: info resumida + invitacion a escribir por WhatsApp
- `SEQUENCE`: 0 para nueva, incrementa en reagendamiento (iOS/Android lo usan para detectar updates)
- `VALARM` x2: -24h y -1h con descripcion legible

**Reagendamiento:** Mismo UID, `SEQUENCE` incrementa, `DTSTART/DTEND` cambian. Calendarios reconocen el update.

**Cancelacion:** Mismo UID, `STATUS:CANCELLED`, `METHOD:CANCEL`. Calendarios eliminan el evento.

---

## 4. FLUJO SIN STORAGE

```
create_appointment exitoso
  → executor.ts retorna { appointment_id, starts_at, ends_at, ... }
  → appointment-agent.ts captura datos en AgentResponse.appointmentData
  → webhook.ts recibe agentResponse
  → envia texto de confirmacion (existente)
  → detecta toolsUsed includes create_appointment/reschedule_appointment
  → genera .ics string con generate-ics.ts
  → convierte a base64
  → envia via sendWhatsAppDocument() como inline document
  → si falla: log y continua (no bloquea)
```

---

## 5. NUEVA FUNCION sendWhatsAppDocument

```typescript
/**
 * Send a document via WhatsApp Business API using base64 inline data.
 * Returns message_id if success, null if failure. Never throws.
 */
export async function sendWhatsAppDocument(
  to: string,
  base64Data: string,
  filename: string,
  mimeType: string,
  clinicCreds?: { phoneNumberId: string; accessToken: string } | null,
): Promise<string | null> {
  const config = getConfig(clinicCreds)
  if (!config) return null

  try {
    // Step 1: Upload media to WhatsApp
    const mediaForm = new FormData()
    const buffer = Buffer.from(base64Data, 'base64')
    mediaForm.append('file', new Blob([buffer], { type: mimeType }), filename)
    mediaForm.append('messaging_product', 'whatsapp')
    mediaForm.append('type', mimeType)

    const uploadRes = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/media`,
      { method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}` }, body: mediaForm }
    )
    const uploadData = await uploadRes.json()
    if (!uploadData.id) {
      console.error('[WhatsApp] Media upload failed:', JSON.stringify(uploadData))
      return null
    }

    // Step 2: Send document message referencing uploaded media
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace('+', ''),
          type: 'document',
          document: {
            id: uploadData.id,
            filename,
          },
        }),
      }
    )

    const data = await res.json()
    if (data.messages?.[0]?.id) return data.messages[0].id

    const errorCode = data.error?.code
    if (errorCode === 131047) {
      console.error('[WhatsApp] Document: FUERA DE VENTANA 24H')
    } else {
      console.error('[WhatsApp] Document send error:', JSON.stringify(data))
    }
    return null
  } catch (err) {
    console.error('[WhatsApp] Document send failed:', err instanceof Error ? err.message : err)
    return null
  }
}
```

**2-step flow:** WhatsApp API requiere primero subir el media (POST /media), luego enviar mensaje referenciando el media ID. No soporta base64 inline directo en el payload de mensajes.

---

## 6. EXTENDER AgentResponse

**Problema encontrado:** `runAppointmentAgent()` retorna `{ text, toolsUsed, tokenUsage }`. No incluye datos estructurados de los tools (appointment_id, starts_at, etc.). Estos datos existen en executor.ts pero se pierden — solo se pasan a Claude como texto.

**Fix:** Agregar campo opcional `appointmentData` al return type:

```typescript
interface AgentResponse {
  text: string
  toolsUsed: string[]
  tokenUsage: { input: number; output: number }
  // Datos de la cita creada/reagendada (para hooks post-confirmacion)
  appointmentData?: {
    id: string
    starts_at: string
    ends_at: string
    doctor_name: string
    consultation_type?: string | null
  }
}
```

En el loop de tools de `appointment-agent.ts`, cuando el tool es `create_appointment` o `reschedule_appointment` y el resultado es exitoso, capturar los datos:

```typescript
if (toolName === 'create_appointment' && result.success) {
  appointmentData = {
    id: result.data.appointment_id,
    starts_at: result.data.starts_at,
    ends_at: result.data.ends_at,
    doctor_name: result.data.doctor_name ?? '',
    consultation_type: result.data.consultation_type ?? null,
  }
}
```

**Nota:** `result.data.doctor_name` puede no estar disponible hoy en el return de executor. Si no, lo agregamos (1 linea).

---

## 7. PUNTO DE INYECCION: WEBHOOK

En `route.ts`, despues de linea 461 (envio de confirmacion exitoso):

```typescript
// Calendar invite (.ics) — solo si se creo o reagendo una cita
if (agentResponse.appointmentData &&
    (agentResponse.toolsUsed.includes('create_appointment') ||
     agentResponse.toolsUsed.includes('reschedule_appointment'))) {
  try {
    const icsString = generateICS({
      appointmentId: agentResponse.appointmentData.id,
      startsAt: agentResponse.appointmentData.starts_at,
      endsAt: agentResponse.appointmentData.ends_at,
      doctorName: agentResponse.appointmentData.doctor_name,
      consultationType: agentResponse.appointmentData.consultation_type,
      clinicName: clinic.name,
      clinicAddress: clinic.address,
      clinicCity: clinic.city,
      isReschedule: agentResponse.toolsUsed.includes('reschedule_appointment'),
    })
    const base64 = Buffer.from(icsString).toString('base64')
    await sendWhatsAppDocument(
      message.from,
      base64,
      'cita.ics',
      'text/calendar',
      clinicCreds,
    )
  } catch (err) {
    console.error('[Webhook] ICS send failed (non-critical):', err instanceof Error ? err.message : err)
  }
}
```

---

## 8. EDGE CASES

| Caso | Manejo |
|------|--------|
| Cita virtual (sin direccion) | LOCATION omitido. DESCRIPTION incluye "Cita virtual — recibiras el enlace 30 min antes" |
| Reagendada multiples veces | Mismo UID (`appointment_id@omuwan.co`), SEQUENCE incrementa. Calendario actualiza evento |
| Cita cancelada | No implementar en V1. El paciente recibe texto de cancelacion. Agregar STATUS:CANCELLED en V2 si hay demanda |
| Numero internacional | Timezone del .ics siempre America/Bogota (es la hora de la clinica, no del paciente). Correcto porque la cita es en Colombia |
| WhatsApp document falla | try/catch, log error, continua. El texto de confirmacion ya se envio |
| Upload de media falla | Mismo — fallo silencioso con log |
| Doctor sin nombre | Fallback: "su doctor" |
| Tipo de consulta sin nombre | Omitir de SUMMARY, usar "Cita medica" generico |

---

## 9. DATOS NECESARIOS DEL EXECUTOR

Para generar el .ics necesitamos datos que hoy el executor retorna pero el webhook no recibe. Verificacion:

| Dato | Disponible en executor return? | Accion |
|------|-------------------------------|--------|
| appointment_id | Si (linea 684) | Pasar via appointmentData |
| starts_at | Si (linea 685) | Pasar via appointmentData |
| ends_at | Si (linea 685) | Pasar via appointmentData |
| doctor_name | **No** en el return | Agregar al return (el doctor ya fue consultado en linea 496) |
| consultation_type | **No** directamente | Agregar nombre si consultation_type_id fue usado |
| clinic_name | Disponible en webhook (clinic.name) | Ya en scope |
| clinic_address | Disponible en webhook (clinic.address) | Ya en scope |

**Cambio en executor.ts:** Agregar `doctor_name` y `consultation_type_name` al return de create_appointment (2 lineas).

Para reschedule_appointment: el return actual (linea 956-963) tiene `new_appointment_id` pero no `starts_at`, `ends_at`, `doctor_name`. Hay que agregar estos campos.

---

## 10. PLAN DE TESTING

1. Generar .ics de prueba, descargar como archivo, abrirlo en iPhone → verificar que aparece en calendario con recordatorios
2. Mismo en Android/Google Calendar
3. Generar segunda version con SEQUENCE:1 y nueva hora → verificar que ACTUALIZA, no duplica
4. Verificar que upload de media a WhatsApp funciona (requiere cuenta de test)
5. Verificar que si upload falla, el flujo principal no se rompe
6. Verificar timezone correcto en el .ics (America/Bogota)

---

## 11. ESTIMACION

| Bloque | Horas |
|--------|-------|
| npm install ics + verificar compatibilidad | 0.25h |
| generate-ics.ts (generador de .ics) | 1h |
| sendWhatsAppDocument (2-step: upload + send) | 1h |
| Extender AgentResponse + capturar appointmentData | 1h |
| Hook en webhook + injection | 0.5h |
| Agregar doctor_name/consultation_type a executor returns | 0.5h |
| Testing manual (iPhone + Android + fallos) | 1h |
| **Total** | **~5.25h** |

---

## 12. FASES DE IMPLEMENTACION

**Fase 1:** install `ics` + `generate-ics.ts` + test unitario de generacion (1.25h)

**Fase 2:** `sendWhatsAppDocument` en client.ts (1h)

**Fase 3:** Extender AgentResponse + capturar datos en appointment-agent.ts + agregar campos a executor returns (1.5h)

**Fase 4:** Hook en webhook + testing end-to-end (1.5h)
