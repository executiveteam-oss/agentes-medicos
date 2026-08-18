# Requerimiento: Reporte de Oportunidad de Citas

> **Origen:** Lady (Algia) lo confirma como **bloqueante regulatorio** para migrar de iSalud a Omuwan.
> **Indicador:** Reporte obligatorio para IPS/consultorios en Colombia (Resolución 256/2016 — Min. Salud).
> **Fecha audit:** Mayo 2026
> **Estado:** Audit técnico — sin código nuevo todavía.

---

## 1. Definición del indicador

**Oportunidad de la cita** = días transcurridos entre la **solicitud** del paciente y la **fecha asignada** para la consulta.

```
oportunidad_cita = fecha_asignada - fecha_solicitud   (en días calendario)
oportunidad_promedio = Σ(oportunidad_cita) / N
```

Se reporta como **promedio mensual** (a veces semanal) por médico/especialidad. Algia hoy lo entrega a las EPS desde iSalud; sin ese reporte no pueden facturar ni cumplir habilitación.

---

## 2. Audit técnico — ¿qué tenemos hoy?

### 2.1 ¿Fecha de solicitud separada de fecha de cita?

**Parcialmente — y con un sesgo grave para clínicas migrando.**

Tabla `appointments` (ver `supabase/migrations/00001_initial_schema.sql`):

| Columna | Significado | Sirve para "fecha de solicitud"? |
|---|---|---|
| `created_at` | Cuándo se insertó el registro en Omuwan | Sí, **solo si** la cita fue creada en Omuwan en el momento de la solicitud |
| `starts_at` | Cuándo es la consulta | No — es la **fecha asignada** |
| `updated_at` | Última modificación | No (cambia con cancelaciones, recordatorios, etc.) |

**Casos de uso de `created_at` por `source`:**

- `source='whatsapp_agent'` → `created_at` ≈ momento en que el paciente confirmó por WhatsApp. **OK como proxy**, aunque el indicador estricto considera el primer mensaje del paciente solicitando.
- `source='manual'` / `source='dashboard'` → `created_at` = momento en que el staff agendó. **Sesgo a la baja** (el paciente puede haber llamado horas/días antes).
- `source='isalud'` → `created_at` = momento del **scrape**, no de la solicitud real. **DATO INSERVIBLE** para el reporte regulatorio.

**Conclusión:** no hay un campo dedicado `requested_at`. Lo necesitamos.

### 2.2 ¿Estado guardado correctamente?

**Sí, con un matiz.** Columna `status` con valores actuales en el código:

| Status DB | Significado regulatorio |
|---|---|
| `confirmed` | Agendada / pendiente |
| `rescheduled` | Reprogramada |
| `completed` | **Atendida** |
| `cancelled` | **Cancelada** |
| `no_show` | Inasistencia (no equivale a "atendida") |
| `blocked_external` | Bloqueo de agenda iSalud (no es cita real) |

Verificado en uso: `src/app/dashboard/noshow/page.tsx`, `src/lib/utils/noshow.ts`, `src/lib/google-sheets/sync-finances.ts`. El mapeo cubre los tres estados que pide Lady.

**Matiz importante para reprogramaciones:** hoy no es claro si una reprogramación crea una nueva cita o solo cambia `starts_at` de la cita original. Para el indicador, la **solicitud original** es lo que cuenta — `requested_at` debe **heredarse** entre reprogramaciones, no resetearse.

### 2.3 ¿Exportación a Excel?

**No existe.**

- Sin dependencia `xlsx` ni `exceljs` en `package.json`.
- No hay ruta `/dashboard/reportes`, `/indicadores`, `/oportunidad`.
- Lo más parecido: `src/lib/google-sheets/sync-finances.ts` y `sync-noshow-stats.ts` empujan datos a Google Sheets, pero no producen `.xlsx` descargable.

Algia hoy descarga Excel desde iSalud y lo manda a la EPS. Sin export `.xlsx` no podemos reemplazar ese flujo.

---

## 3. Migración propuesta

### 3.1 Schema (migración `00070_appointment_requested_at.sql`)

```sql
ALTER TABLE appointments
  ADD COLUMN requested_at TIMESTAMPTZ;

-- Backfill conservador por source:
UPDATE appointments
SET requested_at = created_at
WHERE source IN ('whatsapp_agent', 'manual', 'dashboard')
  AND requested_at IS NULL;

-- Para iSalud: NULL hasta que se rastree desde Omuwan.
-- Reportes existentes deben excluir requested_at IS NULL o etiquetarlas "sin dato".

CREATE INDEX idx_appointments_requested_at
  ON appointments(clinic_id, requested_at)
  WHERE requested_at IS NOT NULL;
```

### 3.2 Captura en los 3 puntos de creación

| Punto | Cómo capturar `requested_at` |
|---|---|
| `src/agents/tools/executor.ts` → `create_appointment` | `requested_at = NOW()` al momento de invocar el tool (el paciente acaba de confirmar) |
| Dashboard manual (`/dashboard/agenda` form) | Campo opcional **"¿Cuándo solicitó la cita?"** (default `NOW()`, editable por staff si llamó días antes) |
| iSalud sync (`src/lib/isalud/sync-agent.ts`) | Si iSalud expone la fecha de solicitud en `/admision` (columna a verificar), usarla. Si no, dejar `NULL`. |

### 3.3 Reprogramaciones

- `requested_at` **NO** se modifica al reprogramar — solo cambia `starts_at`.
- La oportunidad de una cita reprogramada se calcula desde la solicitud **original** hasta la **nueva fecha asignada**. Es el comportamiento que reporta iSalud y lo que las EPS auditan.

---

## 4. Reporte UI (ruta propuesta: `/dashboard/reportes/oportunidad`)

**Filtros:**
- Rango de fechas (sobre `requested_at`)
- Médico (multi-select)
- Estado: `completed` | `cancelled` | `rescheduled` | todos
- Especialidad (cuando aplique)

**KPIs (parte superior):**
- Total citas en rango
- Sumatoria de días de oportunidad
- **Oportunidad promedio (días)** — el número que va a la EPS
- Citas sin `requested_at` (data quality flag)

**Tabla (parte inferior):**

| Paciente | Cédula | Médico | Fecha solicitud | Fecha asignada | Días | Estado |
|---|---|---|---|---|---|---|

**Botón "Exportar a Excel"** → genera `.xlsx` con la tabla + los KPIs en hoja aparte (formato que Lady ya conoce).

**Stack sugerido:** `exceljs` server-side en API route `/api/reportes/oportunidad/export` (streaming para no cargar todo en memoria con miles de citas). Alternativa simple: `xlsx` (SheetJS) — más liviano si solo necesitamos `.xlsx` plano.

---

## 5. Estimación

| Fase | Trabajo | Días hábiles |
|---|---|---|
| 1 | Migración SQL + backfill + validación con datos de Algia | 1 |
| 2 | Captura `requested_at` en agente WhatsApp + dashboard manual + iSalud (heurística) | 1.5 |
| 3 | Página `/dashboard/reportes/oportunidad` (filtros, KPIs, tabla) | 2 |
| 4 | Export Excel (endpoint + lib + formato validado con Lady) | 1 |
| 5 | QA con datos reales de Algia + comparar contra reporte actual de iSalud | 1 |
| 6 | Iteración con Lady (formato exacto que pide la EPS, columnas, fórmula) | 1–2 |

**Total: 7.5 – 9.5 días hábiles ≈ 1.5 – 2 semanas.**

**Riesgo principal:** que la EPS exija columnas/formato específico que solo conozcamos después de la primera entrega. Mitigación: pedir a Lady un reporte `.xlsx` de muestra **antes** de empezar a codear el export.

---

## 6. Dependencias y decisiones bloqueantes

1. **Conseguir un `.xlsx` real de Algia** con el reporte actual de oportunidad → define el formato exacto del export.
2. **Confirmar con Lady** la fórmula precisa: ¿días calendario o hábiles? ¿se incluyen `no_show` y `cancelled` en el promedio o solo `completed`?
3. **Decidir reprogramaciones**: ¿`rescheduled` cuenta como cita atendida en el indicador o se excluye?
4. **iSalud `/admision`**: ¿la columna de "fecha de solicitud" existe en el scrape? Si sí, podemos hacer backfill real para citas históricas; si no, las citas pre-migración quedan sin dato.

---

## 7. Próximo paso recomendado

Antes de empezar a codear: pedir a Lady **un Excel real** del reporte que entrega hoy a las EPS, y validar la fórmula. 30 minutos de esa conversación ahorran reescribir el export.
