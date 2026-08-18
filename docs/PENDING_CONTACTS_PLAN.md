# Pending Patient Contacts — Plan de Implementacion

**Fecha:** 2026-04-30
**Objetivo:** Lista accionable de pacientes que no recibieron notificacion WhatsApp, para que el staff los contacte manualmente.

---

## 1. ESTRUCTURA DE DATOS

**Recomendacion: Opcion B — Tabla nueva `pending_contacts`.**

Por que NO la vista (Opcion A):

- La vista requiere UNION de fuentes con schemas distintos (reminders, audit_log.details JSONB, appointments). Las queries son costosas porque audit_log no tiene indice para `details->>'notified'`.
- No hay forma de hacer UPDATE en una vista para marcar `contacted_manually = true`. Necesitariamos columnas en cada tabla fuente — contaminando schemas que no les corresponde.
- Realtime de Supabase NO funciona con views, solo con tablas. Sin realtime no hay badge en vivo.

Por que SI la tabla nueva:

- Schema limpio con exactamente los campos necesarios.
- Realtime nativo — el badge se actualiza cuando otro staff marca como contactada.
- INSERT desde cualquier flujo es trivial (1 linea despues de cada fallo).
- Consultas rapidas con indice en `(clinic_id, resolved_at)`.
- Auto-archivado simple: `resolved_at IS NOT NULL` o `created_at < NOW() - 7 days`.

**Costo de insercion:** Solo 3 lugares hoy (los 3 else blocks que ya agregamos en Fix D + cancel-notify). No son 9 — la mayoria de flujos pasan por `sendWhatsAppMessage` que retorna null, y el caller ya tiene el else block listo.

---

## 2. SCHEMA: MIGRACION 00066

```sql
-- ============================================================
-- Migration 00066: Pending patient contacts
-- Tracks patients who couldn't be reached via WhatsApp
-- for manual follow-up by staff
-- ============================================================

CREATE TABLE pending_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

  -- What failed
  reason_type TEXT NOT NULL CHECK (reason_type IN (
    'reminder_failed',
    'cancellation_no_delivery',
    'waitlist_notification_failed'
  )),
  reason_text TEXT NOT NULL,  -- Legible: "Recordatorio 24h no entregado"

  -- Patient context (denormalized for fast reads without JOINs)
  patient_name TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  doctor_name TEXT,
  appointment_date TIMESTAMPTZ,

  -- Resolution
  resolved_at TIMESTAMPTZ,          -- NULL = pending, SET = done
  resolved_by UUID,                 -- auth.uid() of staff who resolved
  resolution_method TEXT,           -- 'manual_whatsapp', 'resend_success', 'auto_expired'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup: pending items per clinic
CREATE INDEX idx_pending_contacts_clinic_pending
  ON pending_contacts(clinic_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- Prevent exact duplicates (same source record)
CREATE UNIQUE INDEX idx_pending_contacts_unique_source
  ON pending_contacts(clinic_id, appointment_id, reason_type)
  WHERE resolved_at IS NULL;

-- RLS
ALTER TABLE pending_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_contacts_select" ON pending_contacts
  FOR SELECT TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "pending_contacts_update" ON pending_contacts
  FOR UPDATE TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE auth_user_id = auth.uid()
  ));

-- Service role inserts (from crons and webhook)
-- No INSERT policy for authenticated

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE pending_contacts;
```

**Notas de diseno:**

- `patient_id` permite JOIN futuro pero NO es obligatorio (citas iSalud no tienen patient_id).
- `appointment_id` con ON DELETE SET NULL — si la cita se borra, el pendiente persiste (el staff aun necesita contactar).
- UNIQUE parcial en `(clinic_id, appointment_id, reason_type) WHERE resolved_at IS NULL` previene duplicados si el cron corre dos veces.
- Datos denormalizados (`patient_name`, `patient_phone`, `doctor_name`, `appointment_date`) evitan JOINs en el panel — la tabla se consulta 100% standalone.

---

## 3. INSERCIONES: DONDE SE PUEBLA

### 3a. Recordatorios fallidos (Fix D ya implementado)

**Archivo:** `src/app/api/cron/send-reminders/route.ts`
**Lineas:** Los 3 bloques else que ya creamos (72h, 24h, 2h).
**Cambio:** Despues del `reminders.insert({ status: 'failed' })`, agregar:

```typescript
await supabaseAdmin.from('pending_contacts').insert({
  clinic_id: apt.clinic_id,
  patient_id: apt.patient_id,
  appointment_id: apt.id,
  reason_type: 'reminder_failed',
  reason_text: `Recordatorio ${type} no entregado`,
  patient_name: patient.name,
  patient_phone: patient.phone,
  doctor_name: doctor.name,
  appointment_date: apt.starts_at,
}).catch(() => {}) // no bloquear si ya existe (UNIQUE constraint)
```

### 3b. Cancelacion masiva sin delivery

**Archivo:** `src/app/actions/blocked-dates.ts:126-129`
**Cambio:** Despues de `cancelAndNotifyPatient()`, si `!result.whatsappSent`:

```typescript
if (!result.whatsappSent) {
  await supabaseAdmin.from('pending_contacts').insert({
    clinic_id: clinicId,
    patient_id: ...,  // from affected appointment
    appointment_id: apt.id,
    reason_type: 'cancellation_no_delivery',
    reason_text: result.warning ?? 'Cancelacion no entregada por WhatsApp',
    patient_name: ...,
    patient_phone: ...,
    doctor_name: ...,
    appointment_date: ...,
  }).catch(() => {})
}
```

### 3c. Cancelacion individual sin delivery

**Archivo:** `src/lib/cancel-notify.ts:86-91`
**Cambio:** Mismo patron — si el catch de `sendWhatsAppMessage` se ejecuta, insertar pending_contact.

### Fuentes futuras (sin codigo ahora, se agregan con 1 insert):
- Waitlist notification failed
- Post-consulta NPS failed
- Reactivacion failed

---

## 4. COMPONENTE: PendingContactsButton

### Ubicacion

En `src/app/dashboard/layout.tsx:333`, al lado de NotificationBell:

```tsx
<PendingContactsButton />
<NotificationBell />
```

### Patron: copia de NotificationBell

Sigue el mismo patron que NotificationBell:
- State local con `useState<PendingContact[]>([])`
- Carga inicial via `supabase.from('pending_contacts').select('*').eq(...).is('resolved_at', null)`
- Realtime subscription para INSERT/UPDATE en `pending_contacts`
- Badge con count de `resolved_at IS NULL`
- Click abre panel lateral

### Archivo

`src/components/dashboard/pending-contacts-button.tsx` (~180 lineas)

### UI del panel

```
+------------------------------------------+
| Pendientes de contactar          [X]     |
| 3 pacientes sin notificar               |
+------------------------------------------+
| RECORDATORIOS NO ENTREGADOS (2)         |
|                                          |
| +-[Ana Perez]-------------------------+ |
| | Cita: Mie 30 Abr, 10:00 AM          | |
| | Dr. Martinez · 321 456 7890          | |
| | [Fuera de ventana 24h]  amber pill   | |
| | [Abrir WhatsApp]  [x] Contactada    | |
| +--------------------------------------+ |
|                                          |
| +-[Carlos Ruiz]-----------------------+ |
| | Cita: Jue 1 May, 2:30 PM            | |
| | Dr. Lopez · 300 123 4567            | |
| | [Dentro de ventana]  green pill      | |
| | [Reenviar]  [x] Contactada         | |
| +--------------------------------------+ |
|                                          |
| CANCELACIONES SIN AVISAR (1)            |
|                                          |
| +-[Maria Garcia]----------------------+ |
| | Cita: Mie 30 Abr, 3:00 PM           | |
| | Dr. Martinez · 315 789 0123          | |
| | [Fuera de ventana 24h]  amber pill   | |
| | [Abrir WhatsApp]  [x] Contactada    | |
| +--------------------------------------+ |
+------------------------------------------+
```

### Logica de ventana 24h

La ventana se calcula client-side:

```typescript
function isWithin24hWindow(contact: PendingContact): boolean {
  // Una paciente esta "dentro de ventana" si su ultimo mensaje
  // fue hace menos de 24h. Como no tenemos esa info en pending_contacts,
  // usamos heuristica: si la cita fue agendada por WhatsApp (source='whatsapp_agent')
  // y fue hace menos de 24h, probablemente esta en ventana.
  // Para V1: siempre mostrar como "fuera de ventana" (safe default).
  // V2: consultar conversations.last_message_at del paciente.
  return false
}
```

Para V1, todos los items muestran "Fuera de ventana" y boton "Abrir WhatsApp". El boton "Reenviar" se habilita en V2 cuando tengamos la info de ventana.

---

## 5. ACCION: ABRIR WHATSAPP

Al click en "Abrir WhatsApp":

```typescript
function openWhatsApp(contact: PendingContact) {
  const phone = contact.patient_phone.replace('+', '')
  const message = getPrefilledMessage(contact)
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank')
}

function getPrefilledMessage(contact: PendingContact): string {
  const date = formatDateForPatient(contact.appointment_date)
  const time = formatTimeForPatient(contact.appointment_date)
  const doctor = contact.doctor_name ?? 'su doctor'

  if (contact.reason_type === 'cancellation_no_delivery') {
    return `Hola ${contact.patient_name}, te escribimos de la clinica para avisarte que tu cita del ${date} a las ${time} con ${doctor} fue cancelada. Disculpa las molestias. Podemos reagendarte?`
  }

  // reminder_failed
  return `Hola ${contact.patient_name}, te recordamos tu cita del ${date} a las ${time} con ${doctor}. Confirmas?`
}
```

**NO marca como contactada automaticamente.** El staff hace click en el checkbox despues de enviar.

---

## 6. ACCION: MARCAR COMO CONTACTADA

Server action `markPendingContactResolved`:

```typescript
'use server'
export async function markPendingContactResolved(contactId: string) {
  const { clinicId, authUserId } = await getSessionClinicId() // con user id
  await supabaseAdmin
    .from('pending_contacts')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: authUserId,
      resolution_method: 'manual_whatsapp',
    })
    .eq('id', contactId)
    .eq('clinic_id', clinicId) // tenant isolation
}
```

Realtime propaga el UPDATE — el panel de otros staff actualiza automaticamente.

---

## 7. ACCION: REENVIAR (V2)

**En V1 no se implementa.** El boton "Reenviar" aparece deshabilitado con tooltip "Disponible pronto".

En V2:
- Server action que llama `sendWhatsAppMessage` con las creds de la clinica
- Si exito: marca `resolved_at` + `resolution_method: 'resend_success'`
- Si falla: muestra toast con error

---

## 8. PERSISTENCIA Y REALTIME

```typescript
// En PendingContactsButton
useEffect(() => {
  const supabase = createSupabaseBrowserClient()
  const channel = supabase
    .channel('pending-contacts-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'pending_contacts',
      filter: `clinic_id=eq.${clinicId}`,
    }, (payload) => {
      if (payload.eventType === 'INSERT') {
        setContacts(prev => [payload.new as PendingContact, ...prev])
      }
      if (payload.eventType === 'UPDATE') {
        const updated = payload.new as PendingContact
        if (updated.resolved_at) {
          // Fue resuelta — remover de la lista
          setContacts(prev => prev.filter(c => c.id !== updated.id))
        }
      }
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [clinicId])
```

---

## 9. ENDPOINTS

No se crean API routes. Se usan server actions (patron del proyecto):

| Accion | Archivo | Funcion |
|--------|---------|---------|
| Listar pendientes | `src/app/actions/pending-contacts.ts` | `getPendingContacts()` |
| Marcar como contactada | mismo | `markPendingContactResolved(id)` |
| (V2) Reenviar | mismo | `resendPendingContact(id)` |

`getPendingContacts()` retorna hasta 50 items no resueltos, ordenados por `created_at DESC`.

---

## 10. AUTO-ARCHIVADO

Items se auto-archivan cuando:

1. **Staff los marca como contactados** → `resolved_at = NOW()`
2. **La cita ya paso hace >48h** → Un bloque en el cron `send-reminders` que corre cada hora:

```typescript
// Auto-resolve pending contacts for appointments that already happened >48h ago
await supabaseAdmin
  .from('pending_contacts')
  .update({
    resolved_at: new Date().toISOString(),
    resolution_method: 'auto_expired',
  })
  .is('resolved_at', null)
  .lt('appointment_date', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
```

Esto mantiene la tabla limpia sin intervencion manual.

---

## 11. PLAN DE TESTING MANUAL

1. **Bulk cancel dia** → verificar que aparecen items con `reason_type = 'cancellation_no_delivery'`
2. **Badge muestra count correcto** (3 pendientes = badge "3")
3. **Click en "Abrir WhatsApp"** → abre wa.me con mensaje correcto
4. **Marcar como contactada** → item desaparece, badge decrementa
5. **2 sesiones abiertas** → marcar en una, desaparece en la otra (realtime)
6. **Cita ya paso (+48h)** → se auto-archiva en siguiente cron run
7. **Duplicados** → bulk cancel la misma cita dos veces no crea 2 pendientes (UNIQUE)
8. **Paciente sin telefono** → no deberia aparecer (no se inserta)
9. **Doctor sin clinicId** → protegido por FK constraint

---

## 12. RIESGOS Y EDGE CASES

| Edge case | Manejo |
|-----------|--------|
| Paciente sin telefono | No se inserta pending_contact (el flujo ya hace `if (!patient.phone) continue`) |
| Staff cierra tab sin enviar | Item permanece como pendiente. Solo desaparece con checkbox |
| Misma paciente en multiples reasons | Aparece multiples veces. Cada una es un evento distinto que requiere accion |
| Cita ya paso | Auto-archivado a las 48h via cron |
| Doble ejecucion de cron | UNIQUE parcial `(clinic_id, appointment_id, reason_type) WHERE resolved_at IS NULL` previene duplicados |
| Clinica sin staff logueado | Items se acumulan. Aparecen cuando alguien entra al dashboard |
| WhatsApp credentials faltantes | Se inserta pending_contact con `reason_text` indicando "WhatsApp no configurado" |

---

## 13. ESTIMACION

| Bloque | Horas |
|--------|-------|
| Migracion 00066 + aplicar local/prod | 0.5h |
| Server actions (get, mark, insert helpers) | 1h |
| Inserciones en cron send-reminders (3 bloques) | 0.5h |
| Insercion en cancel-notify + blocked-dates | 0.5h |
| PendingContactsButton componente + panel | 2.5h |
| Auto-archivado en cron | 0.5h |
| Integracion en layout + realtime | 0.5h |
| Testing manual (9 casos) | 1h |
| **Total** | **~7h** |

---

## 14. ARCHIVOS A CREAR/MODIFICAR

| Archivo | Accion | Lineas est. |
|---------|--------|-------------|
| `supabase/migrations/00066_pending_contacts.sql` | Crear | ~40 |
| `src/app/actions/pending-contacts.ts` | Crear | ~80 |
| `src/components/dashboard/pending-contacts-button.tsx` | Crear | ~200 |
| `src/app/api/cron/send-reminders/route.ts` | Modificar | +15 (inserts en 3 bloques else) |
| `src/lib/cancel-notify.ts` | Modificar | +10 (insert en catch) |
| `src/app/actions/blocked-dates.ts` | Modificar | +10 (insert si !whatsappSent) |
| `src/app/dashboard/layout.tsx` | Modificar | +2 (import + render) |

**Total: ~360 lineas nuevas, 3 archivos nuevos, 4 archivos modificados.**
