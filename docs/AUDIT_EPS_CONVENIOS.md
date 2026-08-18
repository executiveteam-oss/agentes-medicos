# Audit: Manejo de EPS y Convenios en Omuwan

**Fecha:** 2026-05-11

---

## 1. ¿Existe tabla/modelo de EPS en la base de datos?

**Estado: EXISTE PARCIAL**

No hay tabla dedicada de EPS. El manejo está distribuido en 3 lugares:

| Ubicación | Campo | Propósito |
|---|---|---|
| `appointments.payment_type` | TEXT ('EPS', 'Particular', 'Póliza', 'ARL', 'SOAT') | Tipo de pago de la cita |
| `appointments.eps_name` | TEXT ('Sura', 'Compensar', etc.) | EPS específica del paciente |
| `patients.eps` | TEXT | EPS del paciente (perfil) |
| `consultation_types.eps_name` | TEXT | Convenio asociado al tipo de consulta |
| `isalud_import_staging` | Tabla completa | Buffer para importar convenios de iSalud |

**Migraciones:** `00006` (payment_type), `00010` (eps_name + billing fields, luego dropped en `00062`), `00051` (consultation_type eps_name), `00050` (staging iSalud).

**Types:** `src/types/database.ts:297-299` — `PaymentType` (5 valores) y `EpsName` (solo 4: Sura, Compensar, Nueva EPS, Sanitas — incompleto).

---

## 2. ¿La clínica puede configurar EPS aceptadas?

**Estado: EXISTE PARCIAL**

La clínica NO tiene una lista centralizada de "EPS que acepto". Lo que tiene:

- **Por tipo de consulta:** Cada `consultation_type` puede tener un `eps_name`. Ejemplo: "Ecografía - Sura", "Ecografía - Compensar" como tipos separados.
- **UI de configuración:** En `/dashboard/settings/doctors/{id}` y en `whatsapp-config-form.tsx`, al crear/editar tipo de consulta, hay campo `eps_name` con badge visual.
- **Importación desde iSalud:** `isalud-convenios.ts` permite importar tarifarios de iSalud con convenio_nombre + productos + tarifas.

**Lo que falta:** No hay configuración central "Mi clínica acepta: Sura, Compensar, Nueva EPS". Cada convenio es un tipo de consulta separado.

---

## 3. ¿Las tarifas se manejan?

**Estado: EXISTE PARCIAL**

| Concepto | Estado | Detalle |
|---|---|---|
| Tarifa particular | ✅ | `consultation_types.price` — precio por tipo de consulta |
| Tarifa EPS | ❌ NO almacenada | El sistema NO guarda tarifa EPS. El prompt dice "el copago te lo confirma la secretaria" |
| Tarifa importada de iSalud | ✅ en staging | `isalud_import_staging.tarifa` — pero solo en tabla buffer, no en producción |
| Tarifa por EPS + tipo consulta | ❌ | No hay tabla de cruce EPS × tipo consulta × tarifa |

**Decisión de diseño actual:** Las tarifas EPS son confidenciales y se manejan fuera del sistema (la secretaria valida en el momento). Solo las tarifas particulares se almacenan y muestran.

---

## 4. ¿El agente pregunta por EPS?

**Estado: EXISTE — FUNCIONA**

**System prompt (`system-prompt.ts:288-376`):**

1. Paso de recolección de datos incluye "6. EPS o si es particular" (línea 338)
2. Paso 3 del flujo: "Validar EPS: si mencionó EPS, usa `check_eps_convenio`" (línea 350)
3. Regla de precios (línea 288-295):
   - Particular → muestra precio
   - EPS con convenio → NO muestra precio, dice "copago te lo confirma la secretaria"
   - EPS sin convenio → ofrece particular con precio

**Tool `check_eps_convenio`** (`tools.ts:272-287`):
- Busca en `consultation_types` WHERE `eps_name` ILIKE input
- Fallback: busca en `isalud_import_staging`
- Retorna `{ hasConvenio: true/false, availableConvenios: [...] }`

**Implementación** (`executor.ts:1196-1262`): Matching flexible con ILIKE y búsqueda parcial.

---

## 5. ¿Cómo se almacena en la cita?

**Estado: EXISTE — FUNCIONA**

```
appointments.payment_type = 'EPS' | 'Particular' | 'Póliza' | 'ARL' | 'SOAT'
appointments.eps_name = 'Sura' | 'Compensar' | null (solo si payment_type = 'EPS')
```

**En `executor.ts:575-579`:** El agente mapea `procedure_entity` del input a `payment_type`. Si el paciente dijo "EPS", se guarda `payment_type: 'EPS'`.

**En `appointments.ts:187-188`:** El dashboard guarda `eps_name` solo si `payment_type === 'EPS'`.

---

## 6. ¿Las conversaciones del seed tienen EPS?

**Estado: EXISTE PARCIAL**

- Conversación #2 del seed: Carlos Alberto Gómez dice "eps coomeva" y el agente responde con instrucciones de carnet.
- 10 de 30 pacientes del seed tienen `eps` seteado (alternando Coomeva, SOS, null).

---

## 7. ¿El dashboard muestra EPS?

**Estado: EXISTE — FUNCIONA**

| Vista | Qué muestra | Archivo |
|---|---|---|
| Agenda semana (tooltip) | `payment_type` en tooltip de cita | `week-view.tsx` |
| Detalle de cita | "Tipo pago: EPS" | `appointment-detail.tsx` |
| Detalle de paciente | "EPS: Sura" en sidebar + payment_type en lista de citas | `patient-detail-v2.tsx` |
| Lista de pacientes | Filtro por EPS (dropdown) | `patients-list-v2.tsx` |
| Formulario de cita | Selector de payment_type + eps_name condicional | `appointment-form-modal.tsx` |
| Formulario de paciente | Selector de EPS | `patient-form-modal.tsx` |

---

## 8. ¿Hay lista hardcoded de EPS?

**Estado: EXISTE — DUPLICADA EN 3 LUGARES**

| Archivo | EPS listadas |
|---|---|
| `patient-form-modal.tsx:12-21` | Sura, Compensar, Nueva EPS, Sanitas, Coosalud, Medimas, Particular, Otra |
| `appointment-form-modal.tsx:48-56` | Sura, Compensar, Nueva EPS, Sanitas, Coosalud, Medimás, Otra |
| `patients-list-v2.tsx:37` | todas, Sura, Compensar, Nueva EPS, Sanitas, Coosalud, Medimas, Particular |
| `types/database.ts:299` | Sura, Compensar, Nueva EPS, Sanitas (solo 4) |

**Problemas:**
- 3 listas distintas en 3 archivos (inconsistencia: "Medimas" vs "Medimás")
- No incluyen muchas EPS colombianas reales (SOS, Salud Total, Famisanar, etc.)
- Hardcoded — no configurables por clínica

---

## BRECHA vs TARGET

| Target | Estado actual | Gap |
|---|---|---|
| Cliente configura lista de EPS aceptadas | No hay UI centralizada. Cada tipo de consulta tiene su eps_name | **M** — crear sección en settings |
| Tarifas particular por tipo + doctor | ✅ Existe (`consultation_types.price`) | Cerrado |
| NO tarifas EPS | ✅ Correcto (prompt no las muestra) | Cerrado |
| Agente pregunta particular o EPS | ✅ Funciona | Cerrado |
| Agente verifica convenio | ✅ `check_eps_convenio` funciona | Cerrado |
| EPS sin convenio → ofrece particular | ✅ Prompt lo maneja | Cerrado |
| EPS con convenio → NO da precio | ✅ Prompt lo maneja | Cerrado |
| Lista de EPS configurable (no hardcoded) | ❌ Hardcoded en 3 archivos | **S** — centralizar |
| Dashboard muestra EPS en citas | ✅ Funciona | Cerrado |

---

## ESTIMACIÓN

| Tarea | Horas |
|---|---|
| Centralizar lista EPS en 1 constante (eliminar duplicados) | 0.5h |
| Agregar más EPS colombianas a la lista | 0.5h |
| Hacer lista configurable por clínica (tabla `clinic_eps` o JSONB) | 3h |
| UI en settings para configurar EPS aceptadas | 2h |
| Conectar `check_eps_convenio` a la lista de la clínica (no solo consultation_types) | 1h |
| **Total para cerrar gap** | **~7h** |

---

## RECOMENDACIÓN

**Priorizar DESPUÉS de la integración iSalud.** Razón: iSalud ya importa convenios con tarifarios completos. Si la clínica usa iSalud, los convenios se importan automáticamente y `check_eps_convenio` ya los encuentra en `isalud_import_staging`.

**Quick wins inmediatos (1h):**
1. Centralizar las 3 listas de EPS en 1 constante compartida
2. Agregar EPS faltantes: SOS, Salud Total, Famisanar, Mutual Ser, Comfenalco, Aliansalud

**Para después (6h):**
1. Tabla `clinic_eps` o JSONB en clinics con EPS aceptadas
2. UI en settings para agregar/quitar EPS
3. `check_eps_convenio` consulta primero `clinic_eps`, luego `consultation_types`, luego staging
