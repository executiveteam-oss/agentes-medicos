# Runbook — Borrado ARCO de documentos recibidos por WhatsApp (Bloque 4)

> **Estado:** Procedimiento manual, PROBADO end-to-end contra producción el
> 2026-07-29 (`scripts/test-arco-deletion-e2e.ts`, 10/10 verde).
> **Cumple:** derecho de cancelación/supresión (ARCO) de la Ley 1581/2012,
> término legal **15 días hábiles**. El endpoint automatizado es fast-follow;
> este procedimiento manual documentado y probado satisface la obligación.

## Cuándo se usa

Cuando un paciente ejerce su derecho a que se **borren** los documentos que envió
por WhatsApp (autorizaciones, órdenes, imágenes) — o su información en general.
El detector determinista de Capa 0 (`detectDataRightsRequest`) escala estos
pedidos al staff y arranca el término legal; este runbook es cómo se cumple.

## Hechos del esquema (verificados 2026-07-29)

La cadena de borrado es **más simple de lo que parece — no hay FKs `RESTRICT`**:

| Referencia | Regla de borrado | Implicación |
|---|---|---|
| `conversation_media.conversation_id` → `conversations` | **CASCADE** | borrar la conversación borra sus filas de media |
| `conversation_media.clinic_id` → `clinics` | **CASCADE** | — |
| `conversation_media.message_id` → `messages` | **SET NULL** | — |
| `appointments.authorization_media_id` → `conversation_media` | **SET NULL** | una cita que apunta al archivo **NO bloquea** el borrado; su columna queda en `NULL` |

**El único gotcha real: Storage NO cascadea.** Borrar la fila de
`conversation_media` **no** borra el archivo del bucket `whatsapp-media`. Hay
que borrar el objeto de Storage **explícitamente**, o queda huérfano ocupando
espacio con un documento clínico.

**El path de Storage no tiene `patient_id`:**
`{clinic_id}/{conversation_id}/{timestamp}_{media_id}.{ext}`. Por eso los
objetos de un paciente se enumeran **por sus conversaciones**, no por su id.

## Orden OBLIGATORIO

**Storage PRIMERO, filas DESPUÉS.** Si borrás las filas antes de capturar el
`storage_path`, perdés el puntero al objeto → queda huérfano en el bucket
(documento clínico sin registro, difícil de encontrar). Siempre:
capturar paths → borrar Storage → borrar filas.

## Procedimiento (SQL en el dashboard de Supabase + Storage)

Reemplazá `:clinic` y los datos del paciente. Ejemplo Algia:
`:clinic = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'`.

### 1. Identificar al paciente

```sql
SELECT id, name, phone, document_number
FROM patients
WHERE clinic_id = :clinic
  AND (phone = :phone OR document_number = :documento);
```

Anotá el `id` → `:patient`.

### 2. Enumerar sus conversaciones

```sql
SELECT id FROM conversations
WHERE clinic_id = :clinic AND patient_id = :patient;
```

### 3. Enumerar los archivos + sus paths (⚠️ ANOTAR los `storage_path`)

```sql
SELECT cm.id, cm.storage_path, cm.context, cm.filename, cm.created_at
FROM conversation_media cm
JOIN conversations c ON c.id = cm.conversation_id
WHERE c.clinic_id = :clinic AND c.patient_id = :patient
ORDER BY cm.created_at;
```

Copiá la columna `storage_path` — se usa en el paso 4.

### 4. Borrar los objetos de Storage (bucket `whatsapp-media`)

**Opción A — Dashboard:** Storage → `whatsapp-media` → navegá a cada `storage_path`
→ borrar. Un archivo a la vez.

**Opción B — programática (misma que usa el cron de retención):** la función
`removeMediaFromStorage(paths)` en `src/lib/whatsapp/media-handler.ts` borra la
lista de paths de una. Es lo que ejercita la prueba E2E.

### 5. Borrar las filas de `conversation_media`

```sql
DELETE FROM conversation_media cm
USING conversations c
WHERE cm.conversation_id = c.id
  AND c.clinic_id = :clinic
  AND c.patient_id = :patient;
```

Las citas que apuntaban a esos archivos quedan con `authorization_media_id = NULL`
automáticamente (FK SET NULL) — **no hay que tocarlas**.

### 6. Verificar

```sql
-- Debe devolver 0
SELECT COUNT(*) AS filas_restantes
FROM conversation_media cm
JOIN conversations c ON c.id = cm.conversation_id
WHERE c.clinic_id = :clinic AND c.patient_id = :patient;
```

Y confirmá en Storage que cada `storage_path` del paso 3 ya **no existe** (404).

### 7. Registrar el cumplimiento (constancia legal)

```sql
INSERT INTO audit_log (clinic_id, action, actor_type, details)
VALUES (:clinic, 'arco_deletion_manual', 'staff', jsonb_build_object(
  'patient_id', :patient,
  'deleted_media_count', :n,
  'requested_at', :fecha_pedido,
  'completed_at', now()
));
```

## Borrado TOTAL del paciente (ARCO amplio, opcional)

Si el pedido es borrar **toda** la información (no solo los documentos), después
del paso 5 seguí — **siempre Storage primero (pasos 3-4) ya hechos**:

```sql
DELETE FROM appointments   WHERE clinic_id = :clinic AND patient_id = :patient;
DELETE FROM conversations  WHERE clinic_id = :clinic AND patient_id = :patient; -- cascadea messages + cualquier media residual
DELETE FROM patients       WHERE clinic_id = :clinic AND id = :patient;
```

> Nota: `conversations` cascadea a `messages` y a `conversation_media`, pero
> **repito: NO cascadea a Storage**. Por eso los pasos 3-4 (borrar objetos)
> van siempre antes, aunque después borres la conversación entera.

## Prueba E2E

`scripts/test-arco-deletion-e2e.ts` crea un paciente de prueba, sube un archivo
REAL a Storage con las funciones productivas, y ejecuta este mismo
procedimiento verificando que el objeto de Storage y las filas desaparecen y
que la cita queda en `NULL`. Correr:

```bash
TZ=America/Bogota npx tsx scripts/test-arco-deletion-e2e.ts
```

Última corrida: 2026-07-29 — **10/10 verde** contra prod (Algia).

## Fast-follow (no bloquea el piloto)

Endpoint/acción de dashboard que haga los pasos 2-7 con un click desde la ficha
del paciente (hoy es SQL manual). El procedimiento manual probado cumple la ley
mientras tanto.
