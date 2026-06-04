# FEATURE — 3 categorías de pago: EPS / Prepagada / Particular

**Fecha:** 3 de junio de 2026
**Estado:** PLAN — no implementado
**Detonante:** Lady (Algia) reportó que pacientes con medicina prepagada (Sura, Colsanitas, etc.) no son EPS pero tampoco particular.
**Severidad del problema actual:** ALTA — el agente está clasificando mal a una porción significativa de pacientes, lo que afecta cobro, copago y validación de convenios.

---

## 0. Correcciones al brief original

Antes de estimar, alineemos el estado real del código vs. el brief:

| Brief original dice | Realidad en el código | Implicación |
|---|---|---|
| "Hoy Omuwan solo distingue EPS vs particular" | `PaymentType = 'EPS' \| 'Particular' \| 'Póliza' \| 'ARL' \| 'SOAT'` (5 valores) | El agente solo usa 2 de los 5 valores existentes. Las otras 3 (Póliza/ARL/SOAT) están en UI pero no en flujo conversacional. Decidir si se mantienen o se colapsan. |
| "agregar columna insurer_type a tabla convenios" | No existe tabla `convenios`. Los convenios viven en `consultation_types.eps_name` | La columna va en `consultation_types`, no en una tabla nueva. |
| "audit anterior mencionó 6 EPS solo" | El archivo centralizado `src/lib/utils/eps-options.ts` tiene **13 EPS** ('Sura', 'Compensar', 'Nueva EPS', 'Sanitas', 'Salud Total', 'Famisanar', 'SOS', 'Coosalud', 'Medimás', 'Mutual Ser', 'Comfenalco', 'Aliansalud', 'Otra'). Las 6 eran las EPS distintas encontradas en los `consultation_types` de Algia. | El audit a hacer es: ¿la lista centralizada cubre todas las EPS reales + prepagadas que mencionarán los pacientes? No es "agregar las 13 faltantes". |
| "payment_type CHECK constraint" | No existe CHECK constraint en SQL; solo `DEFAULT 'Particular'` (migración 00006) | Agregar el CHECK es trabajo nuevo, no modificación. |

---

## 1. Resumen ejecutivo

**Esfuerzo estimado total:** 3–5 días de trabajo focused, asumiendo 1 persona.

**Bloqueos críticos antes de empezar:**
1. Decidir si renombrar columna `eps_name` → `insurer_name` o solo agregar `insurer_type` en paralelo (ver sección 7).
2. Conseguir de Algia la **lista real de prepagadas y EPS** con las que tiene convenio (no asumir desde la lista hardcoded).
3. Decidir si `Póliza`, `ARL`, `SOAT` se mantienen como `payment_type` separados o se colapsan en `Particular` (afecta forms + UI).

**Riesgo principal:** el rename de columna `eps_name` impacta `patients`, `appointments`, `consultation_types`, `isalud_import_staging` (al menos 4 tablas), el tool del agente, 17 menciones en el system prompt, 4 formularios UI y los tipos TypeScript. Probabilidad alta de regresiones si se hace sin tests integrales.

---

## 2. Cambios por componente

### 2.1 Schema SQL — migración `00071_insurer_categories.sql`

| Cambio | Tabla afectada | LOC SQL | Riesgo |
|---|---|---|---|
| Agregar `insurer_type TEXT CHECK (insurer_type IN ('EPS','prepagada')) NULL` | `consultation_types` | ~5 | Bajo |
| Backfill `insurer_type` desde `eps_name` (todos los existentes → `'EPS'`) | `consultation_types` | ~5 | **Medio — backfill incorrecto** (ver §3) |
| Rename `eps_name` → `insurer_name` | `patients`, `appointments`, `consultation_types`, `isalud_import_staging` | ~20 | **ALTO** — código vivo lo referencia |
| Cambiar default `payment_type` y agregar CHECK | `appointments` | ~10 | Medio — datos antiguos deben coincidir |
| Backfill `payment_type` minúsculas a Title Case (`particular` → `Particular`) si aplica | `appointments` | ~5 | Bajo — verificar primero |
| Crear índice en `consultation_types(clinic_id, insurer_type, insurer_name)` | `consultation_types` | ~3 | Bajo |
| Función helper `is_eps_name(text) → boolean` para clasificar EPS conocidas vs prepagadas en runtime | nueva | ~30 | Bajo |

**Total estimado SQL:** ~80 líneas. **Tiempo:** 3–4 horas (incluye verificación con `EXPLAIN` y dry-run en branch).

**Decisión arquitectónica abierta:** el brief pide cambiar `payment_type` CHECK a `('EPS','prepagada','particular')` (minúsculas inconsistentes). Hoy es `'EPS','Particular','Póliza','ARL','SOAT'`. Recomendación: estandarizar todo a Title Case (`EPS`, `Prepagada`, `Particular`) y decidir explícitamente qué hacer con `Póliza/ARL/SOAT` (mantener fuera del flujo del agente pero permitir en form de staff).

---

### 2.2 Código backend

| Archivo | Cambio | LOC | Tiempo |
|---|---|---|---|
| `src/types/database.ts` línea 297, 235, 299 | Renombrar tipo `EpsName` → `InsurerName`; agregar `InsurerType = 'EPS' \| 'Prepagada'`; ampliar `PaymentType` | ~15 | 30 min |
| `src/lib/anthropic/tools.ts` líneas 272–287 | Renombrar tool `check_eps_convenio` → `check_insurer_convenio`. Agregar 2do param `insurer_type`. Actualizar JSON schema. | ~20 | 1 h |
| `src/agents/tools/executor.ts` líneas 79, 1196–1262 | Actualizar case en router + reescribir lógica del executor para filtrar por `insurer_name` Y `insurer_type` | ~80 | 2–3 h |
| `src/agents/tools/executor.ts` líneas 575, 626 | Mapeo de `procedure_entity` → `payment_type` debe contemplar nueva categoría `Prepagada` | ~15 | 1 h |
| `src/agents/prompts/system-prompt.ts` (~17 menciones EPS) | Reescribir flujo 3 opciones: agente pregunta "¿EPS, medicina prepagada, o particular?"; manejar copago/precio diferente por categoría | ~50 | 3–4 h — requiere cuidado |
| `src/lib/validators/*` (Zod schemas para appointments + patients) | Agregar enum `InsurerType` y campo opcional `insurer_name` | ~20 | 1 h |
| `src/lib/utils/eps-options.ts` → renombrar a `insurer-options.ts` | Estructura nueva: `{ name, type, aliases[] }` para cada aseguradora. Agregar prepagadas. Mantener export `EPS_OPTIONS` como alias deprecated para compat. | ~80 | 2 h |
| `src/app/actions/appointments.ts` líneas 114, 188, 341 | UPDATE/INSERT con nuevo campo `insurer_name` + `insurer_type`. Mantener lectura compat por una versión. | ~30 | 2 h |
| `src/app/dashboard/page.tsx` línea 78, otros SELECTs | Actualizar nombres de columna en queries | ~10 | 30 min |

**Total backend:** ~320 líneas, **~14 horas**.

---

### 2.3 UI Dashboard

| Componente | Cambio | LOC | Tiempo |
|---|---|---|---|
| `src/components/dashboard/appointment-form-modal.tsx` líneas 46, 69, 176 | 3 opciones en payment_type; condicionalmente mostrar selector de prepagada vs EPS | ~40 | 2 h |
| `src/components/dashboard/patient-form-modal.tsx` | Igual: 3 categorías + dropdowns dinámicos | ~40 | 1.5 h |
| `src/components/dashboard/doctors/doctor-detail.tsx` líneas 498, 518–527 | UI edición tipo consulta debe permitir setear `insurer_type` además de `insurer_name` | ~30 | 1.5 h |
| `src/components/dashboard/whatsapp-config-form.tsx` línea 1330 | Form de guardar convenio en tipo de consulta debe permitir categoría | ~20 | 1 h |
| **NUEVO:** `src/components/dashboard/convenios-list.tsx` | Vista que separe EPS y Prepagadas (el brief lo pide) — agrupar por tipo, sumar conteos | ~120 | 4 h |
| Vista de cita (calendar tooltips, appointment detail) | Mostrar la categoría junto al nombre de aseguradora | ~20 | 1 h |

**Total UI:** ~270 líneas, **~11 horas**.

---

### 2.4 Tests

| Test | Tipo | LOC | Tiempo |
|---|---|---|---|
| `scripts/test-insurer-categories.ts` — Zod schemas + helpers | Standalone tsx | ~150 | 2 h |
| `scripts/test-check-insurer-convenio.ts` — tool con mock de Supabase para cada combinación insurer_type × eps/prepagada existente vs no | Standalone tsx | ~200 | 3 h |
| `scripts/test-prompt-flujo-prepagada.ts` — historial sintético + verificar que el agente NO confunde EPS con prepagada | Standalone tsx | ~180 | 3 h |
| Reproducir caso Lady (mensaje "suramericana" → debe pedir clarificar si es EPS o Prepagada) | Test específico en el anterior | ~30 | 30 min |
| Smoke test contra el agente real con clave de test (1 conversación E2E) | Manual | — | 1 h |

**Total tests:** ~560 líneas, **~9.5 horas**.

---

### 2.5 Auditoría (item #4 + #6 del brief)

**#4 — Lista hardcoded** (ya parcialmente hecho):

La lista actual en `src/lib/utils/eps-options.ts`:
```
Sura, Compensar, Nueva EPS, Sanitas, Salud Total, Famisanar,
SOS, Coosalud, Medimás, Mutual Ser, Comfenalco, Aliansalud, Otra
```

**Faltan** (a confirmar con Algia):
- **Prepagadas conocidas:** Sura Prepagada (distinta de Sura EPS), Colsanitas, Coomeva Prepagada, Allianz Salud, MediPlus, Coosalud Prepagada, Colmédica
- **EPS faltantes posibles:** EPS Sanitas (vs Sanitas Prepagada), Cafesalud (liquidada — no), Capital Salud, Asmet Salud, Emssanar, Cruz Blanca (liquidada — no)
- **Aliases para "suramericana":** mapear a {Sura EPS, Sura Prepagada} con pregunta de disambiguación

**Trabajo:** ~2 h investigación + ~1 h codificar la lista nueva con estructura `{ name, type, aliases[] }`.

**#6 — Audit de precio $100,400 para Algia** (ya hecho en sesión anterior, ver `docs/BUG_CONFIRMACION_IDENTIDAD.md` y conversación del 3 jun 2026):

- Origen confirmado: tipo `CONSULTA DE PRIMERA VEZ POR ESPECIALISTA EN GINECOLOGIA Y OBSTERICIA` (`df055e0b-cf1d-4a3b-a0e9-53aef6afece7`)
- Precio: 100,400 COP, etiquetado a **ALLIANZ SEGUROS DE VIDA S.A.** — **NO es particular, es tarifa de convenio**
- Cargado por: agente importador de iSalud, el 2026-04-20 16:25:59 (`isalud_convenios_imported_for_doctor`, 10 created/100 selected)
- **Conclusión:** los 14 tipos de Algia con precio están todos etiquetados a una EPS específica. **CERO precios particulares** existen para Algia. El agente está mostrando tarifas de convenio como si fueran particulares — bug estructural orthogonal a este feature pero relacionado.

**Recomendación:** marcar visualmente en el dashboard cuando un tipo tiene precio pero su `insurer_type` es no nulo → "este es un precio de convenio, no particular". Y agregar campo nuevo `particular_price INT NULL` a `consultation_types` para que los staff puedan setear el verdadero precio particular (fuera de scope de este feature, pero anotar como deuda).

**Tiempo audit:** 2 h (ya hecho parcialmente).

---

## 3. Plan de migración de data existente

**Datos en producción a considerar:**

```sql
-- Cuántos registros tienen eps_name no nulo
SELECT 'patients' AS tabla, COUNT(*) FROM patients WHERE eps_name IS NOT NULL
UNION ALL
SELECT 'appointments', COUNT(*) FROM appointments WHERE eps_name IS NOT NULL
UNION ALL
SELECT 'consultation_types', COUNT(*) FROM consultation_types WHERE eps_name IS NOT NULL
UNION ALL
SELECT 'isalud_import_staging', COUNT(*) FROM isalud_import_staging WHERE convenio_nombre_abreviado IS NOT NULL;
```

**Estrategia de backfill propuesta:**

1. **Paso 1 (migración DDL):** crear nuevas columnas `insurer_name` y `insurer_type` SIN borrar `eps_name`. Backfill `insurer_name = eps_name`.

2. **Paso 2 (backfill clasificación):**
   - Asumir EPS por defecto NO es seguro — datos como ALLIANZ son tarifas, no EPS.
   - Implementar función helper `classify_insurer(name TEXT) RETURNS TEXT` que use heurísticas:
     - Match contra lista conocida de prepagadas → `'Prepagada'`
     - Match contra lista conocida de EPS → `'EPS'`
     - Caso ambiguo → `NULL` (staff debe completar manualmente desde dashboard)
   - Generar reporte de ambiguos antes del backfill.

3. **Paso 3 (deprecar `eps_name`):** mantener columna `eps_name` como `GENERATED ALWAYS AS (insurer_name) STORED` por una semana para compat con queries legacy. Eliminar en migración 00072 tras verificar que ningún query lo usa.

4. **Paso 4 (cleanup):** drop column `eps_name`, drop helper si ya no se necesita.

**Tiempo migración:** 4 h (incluye dry-run en branch + verificación de reportes).

---

## 4. Estimación temporal por fase

| Fase | Componentes | Tiempo | Acumulado |
|---|---|---|---|
| **Fase 0 — Discovery** | Confirmar lista real con Algia, decidir scope Póliza/ARL/SOAT, decidir rename vs alias | 4 h | 4 h |
| **Fase 1 — Schema + backfill** | Migración 00071 + reporte ambiguos + backfill | 8 h | 12 h |
| **Fase 2 — Backend** | Tool, executor, prompt, validators, types | 14 h | 26 h |
| **Fase 3 — UI** | 4 forms + vista nueva convenios | 11 h | 37 h |
| **Fase 4 — Tests** | 3 test scripts + smoke E2E | 9.5 h | 46.5 h |
| **Fase 5 — Audit + cleanup** | Lista insurers + audit precio + eliminar `eps_name` | 4 h | 50.5 h |
| **Fase 6 — Verificación con Lady** | Deploy + re-test caso prepagada | 2 h | 52.5 h |

**Total: ~52 horas ≈ 7 días de trabajo a 8h/día**, o 3–4 días si se trabaja focused sin interrupciones. El rango 3–5 días del resumen ejecutivo asume que Fase 4 (tests) se reduce a tests críticos solamente.

---

## 5. Riesgos no considerados en el brief

### R1 — Disambiguación de "Sura" (CRÍTICO)
"Sura" como input del paciente puede ser **Sura EPS** O **Sura Prepagada** — son productos distintos de la misma aseguradora con tarifas y convenios diferentes. El brief asume que `insurer_name + insurer_type` resuelve esto, pero el paciente típicamente solo dice "Sura". El agente debe **preguntar siempre** la categoría cuando hay ambigüedad, o el flujo va a confundirse silenciosamente. Tests deben cubrir esto explícitamente. Misma situación con Coomeva, Sanitas (Sanitas EPS vs Colsanitas Prepagada), Allianz.

### R2 — Backfill incorrecto en data legacy
Backfillar `insurer_type='EPS'` a todos los registros con `eps_name` no nulo es **incorrecto** para Algia. Sus `consultation_types` tienen "ALLIANZ SEGUROS DE VIDA S.A.", "COLMEDICA MEDICINA PREPAGADA SA.", "AXA COLPATRIA MEDICINA PREPAGADA SA", "COOMEVA MEDICINA PREPAGADA S.A" — **todas prepagadas**, no EPS. Hacer el backfill sin clasificación va a meter datos sucios. Hay que clasificar primero, ambiguos pendientes para staff.

### R3 — Tool rename rompe llamadas en caché del modelo
Renombrar `check_eps_convenio` → `check_insurer_convenio` cambia el nombre que Claude espera. Si una conversación está abierta cuando hacemos el deploy, el modelo puede intentar llamar la tool vieja por un turno antes de ver el nuevo system prompt. Mitigación: mantener BOTH names funcionando por 24h (alias en executor router).

### R4 — Mensajes guardados en `messages` quedan inconsistentes
El system prompt actual instruye al agente a decir frases específicas con la palabra "EPS". Tras deploy, mensajes históricos en la tabla `messages` siguen diciendo "EPS" en contextos donde ahora diríamos "prepagada". No es bug, pero confunde al staff que revisa transcripciones. Anotar en docs para staff.

### R5 — `insurer_name` en patients es input libre del paciente
Hoy `patients.eps_name` se setea con lo que el paciente dijo. Si el agente preguntó "¿qué EPS?" y guardó "Sura Prepagada", la columna se llamaría `insurer_name` pero el dato es incorrecto en su clasificación (eso es prepagada, no EPS). Solución: el tool `check_insurer_convenio` debería ser quien escriba `patients.insurer_type` validado, no el agente directamente.

### R6 — UI de Algia no estaba preparada para mostrar 3 categorías
El form de Algia probablemente fue diseñado asumiendo 2 botones. Agregar 3 botones en mobile (donde se llena mucho) puede romper layout. Validar en pantallas chicas.

### R7 — iSalud sync va a sobrescribir el `insurer_type` manual
El agente de import de iSalud (`src/lib/isalud/convenios-agent.ts`) puebla `eps_name` desde el nombre del convenio en iSalud. Si staff clasificó manualmente un convenio como Prepagada y luego se re-importa, se va a perder. Necesita lógica: "no sobrescribir si ya fue clasificado manualmente" — agregar columna `insurer_type_set_by_staff BOOLEAN DEFAULT false`.

### R8 — `consultation_types.price` sigue siendo ambiguo
Aun después de este feature, `price` no distingue "precio convenio para esa EPS/prepagada" vs "precio particular". Este feature mejora la clasificación de aseguradoras pero NO arregla el problema raíz que descubrimos con Lady: que el agente confunde tarifas de convenio con precios particulares. Sugerir **scope-out** una migración futura `00072` que agregue `particular_price INT NULL` y cambie semántica de `price` a "precio del convenio si insurer_type no es null, sino particular".

### R9 — Rollback no es trivial
Si tras deploy detectamos un bug crítico, revertir la migración requiere restaurar `eps_name` desde `insurer_name`, lo cual es trivial — pero revertir el código requiere revert de múltiples commits. Recomendación: hacer todo el feature en una sola PR para que revert sea atómico.

### R10 — RLS policies
Las policies de RLS actuales (`messages`, `conversations`, etc.) no referencian `eps_name`, pero verificar antes que ningún policy menciona el nombre viejo. Si lo menciona, falla silenciosamente y empieza a bloquear queries legítimas.

---

## 6. Decisiones abiertas (necesitan input)

1. **Rename vs paralelo:** ¿Renombrar `eps_name` → `insurer_name` (más limpio pero más riesgo) o agregar `insurer_type` y dejar `eps_name` (menos limpio pero seguro)?
2. **Scope Póliza/ARL/SOAT:** ¿Se mantienen como `payment_type` separados en form de staff o se colapsan en `Particular`?
3. **Categoría "Otra":** Hoy "Otra" es opción de EPS. ¿Qué pasa con "Otra prepagada"? ¿Un solo "Otra" sin tipo o uno por categoría?
4. **`check_insurer_convenio` con `insurer_type` opcional o requerido:** Si requerido, el agente debe preguntar siempre la categoría. Si opcional, el tool intenta inferir y puede fallar silenciosamente.
5. **Backfill: bloquear deploy hasta que staff clasifique ambiguos, o deployar con ambiguos en NULL y permitir uso del agente con fallback "particular"?**

---

## 7. Recomendación

**Hacer el feature en 2 sub-fases:**

- **Sub-fase A (ship rápido, 1.5 días):** Solo agregar `insurer_type` a `consultation_types` + actualizar tool `check_eps_convenio` para aceptar `insurer_type` opcional + agregar 6 prepagadas a la lista hardcoded + actualizar prompt para preguntar 3 opciones. NO renombrar `eps_name`. NO tocar formas UI todavía. Permite a Lady probar la disambiguación en WhatsApp ya.

- **Sub-fase B (limpieza completa, 3–4 días):** Renombrar `eps_name` → `insurer_name` en todas las tablas, actualizar UI, validators, deprecar nombres viejos. Hacer tras observar Sub-fase A en producción por 1 semana.

Esto reduce riesgo de regresión y permite responder a Lady "ya está parchado" sin esperar todo el rework.

---

## 8. Próximos pasos sugeridos

1. Decidir las 5 cuestiones abiertas de §6 con Algia/equipo
2. Pedir a Algia la lista REAL de convenios EPS y prepagadas con que trabajan
3. Generar reporte de clasificación ambigua (`SELECT DISTINCT eps_name FROM consultation_types WHERE eps_name IS NOT NULL` agrupado por clínica)
4. Aprobar la sub-fase A
5. Crear branch `feat/insurer-categories` y empezar Fase 0
