# BUG — Agente niega disponibilidad de lunes por shift de timezone

**Fecha:** 4 de junio de 2026
**Reportado por:** Lady (Algia)
**Severidad:** CRÍTICA — afecta a 28+ doctores en 6 clínicas. Toda consulta de "lunes" se rechaza falsamente.
**Estado:** Diagnóstico completo. SIN fix aplicado todavía.

---

## 1. Reproducción exacta

Conversación de Lady (conv_id `24421d61-47a5-483b-903c-0f6ca5bf5aac`):

```
2026-06-04 12:42:42 Lady  → "jorge dario"
2026-06-04 12:42:45 Agente → "Perfecto, con el Dr. Jorge Darío López Isanoa.
                              ¿Qué fecha te queda mejor para tu cita?"
2026-06-04 12:43:00 Lady  → "lunes"
2026-06-04 12:43:17 Agente → "El Dr. Jorge Darío no atiende los lunes.
                              Atiende martes, miércoles, jueves, viernes y sábados."
```

Configuración real de `doctors.working_hours` para Jorge Darío (verificada en BD):

```json
{
  "monday":    { "active": true,  "blocks": [{"start":"08:00","end":"18:00"}] },
  "tuesday":   { "active": true,  "blocks": [{"start":"08:00","end":"18:00"}] },
  "wednesday": { "active": true,  "blocks": [{"start":"08:00","end":"18:00"}] },
  "thursday":  { "active": true,  "blocks": [{"start":"08:00","end":"18:00"}] },
  "friday":    { "active": true,  "blocks": [{"start":"08:00","end":"18:00"}] },
  "saturday":  { "active": true,  "blocks": [{"start":"08:00","end":"13:00"}] },
  "sunday":    { "active": false, "blocks": [{"start":"00:00","end":"00:00"}] }
}
```

**Lunes está claramente activo 08:00-18:00.** El agente miente.

---

## 2. Root cause (timezone shift en parseISO)

Bug raíz: **`src/agents/tools/executor.ts:162`** + **línea 249**.

### El código culpable

```ts
// línea 162 — parsea YYYY-MM-DD como UTC midnight (NO tiene timezone)
const date = parseISO(dateStr)

// línea 249 — convierte a Colombia y lee el día
const dayOfWeek = getDayOfWeek(date)  // usa toZonedTime + getDay()
const dayKey = dayOfWeek as keyof typeof clinic.working_hours

// luego:
const dayCfg = docHours[dayKey]
if (dayCfg.active && dayCfg.blocks.length > 0) { isDayActive = true; ... }
```

### Por qué falla

`parseISO('2026-06-08')` (lunes) sin sufijo de timezone produce **midnight UTC**:
- `2026-06-08T00:00:00.000Z`

`toZonedTime(date, 'America/Bogota')` convierte ese instante a wall-clock en Bogotá (UTC-5):
- Wall-clock = `2026-06-07T19:00:00` → **domingo 7 jun, 7 PM**

`.getDay()` retorna **0 (sunday)**. El `dayKey` lookup busca `docHours.sunday` que está inactive → retorna `"El doctor no atiende ese día (lunes)"`.

**El mensaje dice "lunes" pero el lookup usó la config de domingo.** Por eso el agente parece coherente pero está mal.

### Reproducción ejecutable

```ts
import { parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const d = parseISO('2026-06-08')                    // 2026-06-08T00:00:00.000Z
const z = toZonedTime(d, 'America/Bogota')          // 2026-06-07T19:00:00.000Z (representación shift-hack)
console.log(z.getDay())                             // → 0 (Sunday) ← bug
```

Confirmado con date-fns 4.1.0 + date-fns-tz 3.2.0 (versiones de producción).

### Función correcta de comparación (la otra existe en el mismo archivo)

```ts
// línea 28 — esta SÍ está bien (usa noon COT, evita el shift)
function spanishDayOfWeek(dateStr: string): string {
  return SPANISH_DAY_NAMES[
    toZonedTime(parseISO(`${dateStr}T12:00:00-05:00`), TIMEZONE).getDay()
  ]
}
```

El bug es que `check_availability` usa una sin sufijo y otra con sufijo, dando información INCONSISTENTE al modelo:
- `dayKey` calculado con sufijo ausente → buscó domingo
- `reason` con `spanishDayOfWeek(dateStr)` calculado con sufijo correcto → dijo "lunes"

---

## 3. Cobertura del bug — TODOS los días están shifteados

Reproducción exhaustiva (server TZ=UTC, doctor con sunday inactivo):

| Fecha pedida | Día esperado | dayKey usado | Resultado |
|---|---|---|---|
| 2026-06-08 | **lunes** | sunday | ❌ "no atiende lunes" |
| 2026-06-09 | martes | monday | 🟡 Ofrece slots Mon (8-18) en martes — accidentalmente OK |
| 2026-06-10 | miércoles | tuesday | 🟡 Idem |
| 2026-06-11 | jueves | wednesday | 🟡 Idem |
| 2026-06-12 | viernes | thursday | 🟡 Idem |
| 2026-06-13 | **sábado** | friday | ❌ Ofrece slots 8-18 cuando sábado real es 8-13 (4 PM phantom) |
| 2026-06-14 | **domingo** | saturday | ❌ Ofrece slots 8-13 cuando doctor NO atiende domingo |

**3 categorías de daño**:
1. **Lunes** → rechazo total ("no atiende") — el síntoma que reportó Lady
2. **Sábado** → ofrece horarios 8:00 AM-6:00 PM cuando son 8 AM-1 PM. Cita a las 4 PM sábado no existirá.
3. **Domingo** → ofrece horarios fantasma cuando el doctor descansa.

Tue-Vie funcionan por coincidencia: el día anterior tiene el mismo horario.

---

## 4. Scope — cuántos doctores afectados

Query a producción (2026-06-04):

| Clínica | Doctores activos | Con sunday inactivo (afectados) |
|---|---|---|
| **ALGIA** | 9 | **9** |
| TESTING LondoMEdical (legacy iSalud) | 9 | 9 |
| Centro Médico Bolívar | 3 | 3 |
| Consultorio Médico Demo | 3 | 3 |
| Los Puchis | 3 | 1 |
| Clínica Dental Sonrisa | 1 | 0 (Sunday activo) |
| ABANDONED LondoMEdical | 1 | 0 |
| **TOTAL** | **29** | **25 afectados** |

**El 86% de doctores activos en la plataforma sufren este bug.** Cualquier paciente que diga "lunes" desde el cliente real va a recibir el "no atiende".

---

## 5. Por qué la cita del martes Jun 9 sí funcionó

Lady eventualmente agendó martes Jun 9 a las 8 AM. ¿Por qué eso sí funcionó si la regla está rota?

Trace:
1. Lady pide "martes" → `calculate_date('martes')` → devuelve `'2026-06-09'` y `day_of_week_spanish: 'martes'` (correcto, esta tool usa noon COT)
2. Agente llama `check_availability(doctor_id, '2026-06-09')`
3. Bug: dayKey lookup retorna 'monday' → docHours.monday.active=true, blocks 08-18 → retorna slots 08-18
4. Cosmicamente las horas de lunes y martes son IGUALES para Jorge (ambos 08-18) → slots ofrecidos son correctos
5. Agente confirma "martes 9 jun 8 AM" porque `spanishDayOfWeek('2026-06-09') = 'martes'` (función con noon COT, correcta)
6. `create_appointment` con `starts_at = '2026-06-09T08:00:00-05:00'` → graba Tue Jun 9 8 AM COT correctamente

Resultado correcto **por coincidencia de horarios**. Para sábado/domingo no sería así.

---

## 6. Otras ubicaciones del mismo patrón buggy

Auditando `parseISO(...).getDay()` o equivalente en el repo:

| Archivo | Línea | Estado |
|---|---|---|
| `src/agents/tools/executor.ts` | 162 + 249 | **🐛 BUG (check_availability)** |
| `src/agents/tools/executor.ts` | 270 | **🐛 BUG (whatsapp_config.doctors fallback)** — usa `date.getDay()` del mismo `date` buggy. No se manifiesta hoy porque Jorge no tiene config en `whatsapp_config.doctors` (es null), pero otros doctores podrían |
| `src/agents/tools/executor.ts` | 28 | ✅ `spanishDayOfWeek` — correcto |
| `src/agents/tools/executor.ts` | 346 | ✅ usa `parseISO(\`${dateStr}T12:00:00-05:00\`)` — correcto |
| `src/agents/tools/executor.ts` | 690 | ✅ usa `format(toZonedTime(parseISO(starts_at)))` con ISO completo |
| `src/agents/tools/executor.ts` | 1302 | ✅ `calculate_date` usa `toZonedTime(new Date(), TIMEZONE).getDay()` — correcto |
| `src/agents/tools/executor.ts` | 1325 | ✅ `targetDate.getDay()` sobre date ya zoned — correcto |

**Conclusión:** son 2 instancias buggy del mismo patrón, ambas en `check_availability`. El resto del codebase usa el patrón correcto.

---

## 7. Por qué los tests previos no lo detectaron

- `scripts/test-agent-guards.ts` y `scripts/test-insurer-options.ts` son tests de regex/clasificación, NO tocan timezones.
- No hay test de `check_availability` ni de `calculate_date`.
- En desarrollo local con `TZ=America/Bogota`, `parseISO('2026-06-08')` produce midnight COT que en Bogotá ES lunes → bug **invisible**. Solo aparece en Vercel (UTC).
- El bug existe desde que se agregó `check_availability` (no es regresión reciente).

---

## 8. Hipótesis A–E del brief — evaluación

| # | Hipótesis | Evidencia | Veredicto |
|---|---|---|---|
| A | Mapeo día de semana | `getDayOfWeek` y `SPANISH_DAY_NAMES` están bien indexados | ❌ no es el bug |
| B | Lunes específico bloqueado (festivo/vacaciones) | Query a `blocked_dates` — Jorge no tiene entradas | ❌ no es el bug |
| C | Tool filtra por "días con citas existentes" | El código no infiere días desde appointments | ❌ no es el bug |
| D | System prompt sesgo | El prompt NO incluye lista de días para Jorge (whatsapp_config.doctors.jorge = null) | ❌ no es el bug |
| E | Query usa template incorrecto | NO: el template viene de `doctors.working_hours` correctamente | ❌ no es el bug |
| **F** (no en brief) | **TZ shift en parseISO + getDay()** | Reproducido en runtime real con date-fns 4.1.0 | ✅ **ROOT CAUSE** |

---

## 9. Plan de fix propuesto (NO aplicado)

**Fix mínimo** (1 línea cambio en cada sitio buggy):

```diff
// src/agents/tools/executor.ts:162
- const date = parseISO(dateStr)
+ const date = parseISO(`${dateStr}T12:00:00-05:00`)
```

Esto hace que `date` sea el instante de mediodía COT del día solicitado. `getDayOfWeek(date)` después retorna el día correcto (sin shift), porque `toZonedTime` no cambia el wall-clock day cuando el input ya es mediodía local.

**Verificación post-fix**:
```
2026-06-08 (lunes) → dayKey = 'monday' ✅
2026-06-13 (sábado) → dayKey = 'saturday' ✅
2026-06-14 (domingo) → dayKey = 'sunday' ✅
```

Línea 270 (`const dayNum = date.getDay()`) se beneficia automáticamente del mismo fix porque usa el mismo `date`.

**Test de regresión** que se debería agregar (`scripts/test-check-availability-tz.ts`):
- 7 casos: cada día de la semana
- Validar `dayKey` resuelto coincide con el día español esperado
- Correr con `TZ=UTC` Y `TZ=America/Bogota` para asegurar ambos pasen

---

## 10. Riesgos del fix

- **R1**: si hay código downstream que asume `date` está al midnight local (no noon-COT), podría romperse. Auditando líneas 210-211, el código usa `dateStr` reformateado a `T00:00:00-05:00` y `T23:59:00-05:00` para los rangos de query — independiente de `date`, no afecta. Bajo riesgo.
- **R2**: `dayBlocks[0].start` se concatena a `${dateStr}T${start}:00-05:00` para `dayStart` (línea 303). Usa `dateStr` directo, no `date`. Sin riesgo.
- **R3**: el fix tiene que aplicarse a línea 162 únicamente. Las otras llamadas que usan `${dateStr}T12:00:00-05:00` están ya bien.

---

## 11. Próximos pasos

1. **Tu OK** para aplicar el fix de 1 línea en `executor.ts:162`
2. Agregar test `scripts/test-check-availability-tz.ts` con 14 casos (7 días × 2 zonas horarias del runtime)
3. Deploy
4. Verificación: Lady prueba "lunes" → agente ofrece slots 8 AM - 6 PM
5. Backfill manual: no hay; el bug solo afectaba al rechazo en tiempo real, no a citas creadas (que graban `starts_at` con TZ explícito)

**Estimación**: 1 hora total (fix 5 min + tests 30 min + deploy + verificación).

---

## 12. Conversación de Lady — evidencia preservada

`conv_id 24421d61-47a5-483b-903c-0f6ca5bf5aac` en BD. Mensajes clave:
- `7d4de889-8a64-4f01-ac51-6c5ecbe340e6` (12:43:00) — "lunes"
- `548a5490-b975-4a71-a7bd-8e2b7707d0f6` (12:43:17) — bug
- `f3e2a619-674a-40cd-b4b3-231bfee54665` (12:53:32) — bug repetido
- `16975a10-3a8c-47bc-9723-42dd4fbe51f4` (12:55:14) — cita Jun 9 finalmente creada

Útil como caso de test para el fix.
