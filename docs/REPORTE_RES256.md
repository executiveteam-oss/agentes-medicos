# Reporte Resolución 256 — Manual de uso

> **Resolución 256 de 2016, Registro Tipo 2 — MinSalud Colombia**
> Reporte semestral obligatorio de oportunidad de citas para las IPS.
> Se sube a la plataforma PISIS de SISPRO.

**Audiencia:** Staff administrativo (Lady en Algia, eventualmente otras clínicas).
**Estado:** Fase 1 — funcional para citas creadas en Omuwan. Citas históricas iSalud quedan para Fase 2.

---

## TL;DR — los 3 pasos

1. **Una vez al principio:** clasificar tipos de consulta en `/dashboard/configuracion/res256-categories` (~2 min)
2. **Cada semestre:** generar el reporte en `/dashboard/reportes/resolucion-256` (~5 seg)
3. **Subir a PISIS:** usar la hoja "Listas para PISIS" del xlsx descargado

---

## Paso 1 — Clasificar los tipos de consulta (una vez)

Antes de generar el primer reporte, hay que decirle al sistema **qué tipos de consulta son reportables**. La Resolución 256 cubre 4 categorías:

- **Ginecología** — consultas y procedimientos ginecológicos (histeroscopias, biopsias, etc.)
- **Obstetricia** — controles prenatales, atención del parto
- **Ecografía** — todas las ecografías (obstétricas, ginecológicas, dinámicas)
- **Resonancia Magnética** — todas las RMN

Las demás especialidades (Fisioterapia, Psicología, Colposcopia sola, etc.) se marcan como **No aplica al reporte**.

### Cómo clasificar

1. En el dashboard, ve a **Configuración → Clasificación Res-256**
   (URL directa: `/dashboard/configuracion/res256-categories`)
2. Verás una lista de todos los tipos de consulta activos de tu clínica
3. Para cada tipo, el sistema te muestra una **sugerencia en gris** basada en el nombre. Por ejemplo:
   - "HISTEROSCOPIA DIAGNOSTICA" → sugerencia: **Ginecología**
   - "TERAPIA DE PISO PELVICO" → sugerencia: **NoAplica**
   - "CONSULTA CONTROL POSQUIRURGICO" → sin sugerencia (tú decides)
4. Tres formas de aprobar:
   - **Aceptar todas las sugerencias:** clic en "Seleccionar todos con sugerencia" → "Aplicar sugerencias seleccionadas"
   - **Caso por caso:** elige una categoría en el dropdown de cada tipo
   - **Tipos dudosos:** los que no tienen sugerencia (por seguridad, mejor que tú decidas activamente) — abre el dropdown y elige
5. Filtro **"Solo sin clasificar"** (encendido por defecto): te muestra solo los pendientes. Apágalo para ver todos.

### Por qué algunos tipos no tienen sugerencia

Casos como "CONSULTA ENTREGA DE RESULTADOS" o "COLPOSCOPIA" sola son ambiguos — pueden ser Ginecología (entrega de resultados de una consulta gineco), Ecografía (entrega de eco), o ninguno (si es entrega de resultados de fisioterapia). El sistema **no asume** para evitar que clasifiques mal y termines reportándole datos equivocados al MinSalud. Tú decides.

### Si se importa un tipo nuevo después

Cada vez que iSalud sincronice o tú crees un tipo manualmente, queda **sin clasificar** (igual que tu primera vez). Pasa por la página de clasificación cuando quieras.

---

## Paso 2 — Generar el reporte

1. En el dashboard, ve a **Reportes → Resolución 256 — Oportunidad de Citas**
   (URL directa: `/dashboard/reportes/resolucion-256`)
2. El rango por defecto es el **semestre actual** (Enero–Junio o Julio–Diciembre según el mes). Ajustalo si querés otro rango.
3. Click **"Descargar Excel"**.
4. El archivo `oportunidad-256-YYYY-MM-DD-a-YYYY-MM-DD.xlsx` se descarga automáticamente.
5. Bajo el botón verás el resumen: **X listas para PISIS · Y incompletas**.

### Validaciones del rango

- `Desde` y `Hasta` son obligatorios
- `Hasta` no puede ser futuro
- Rango máximo: 1 año
- Si la clínica no tiene citas en el rango, el reporte tiene 0 filas — eso es normal cuando recién arrancás.

---

## Paso 3 — Entender las 2 hojas del Excel

### Hoja 1: "Listas para PISIS"

Estas son las citas que cumplen TODOS los requisitos del MinSalud:
- 12 columnas exactas en orden PISIS (IDENTIFICACION, NUMERO, FECHA NACIMIENTO, GENERO, PRIMER NOMBRE, SEGUNDO NOMBRE, PRIMER APELLIDO, SEGUNDO APELLIDO, CODIGO EAPB, FECHA SOLICITUD CITA, FECHA ASIGNACION, FECHA DESEADA)
- Todos los campos obligatorios completos
- Paciente no es Póliza ni SOAT (excluidos por la resolución)
- Para Ginecología y Obstetricia: solo la primera cita del año de cada paciente (regla de la resolución)
- Para Ecografía y Resonancia: todas las citas

**Esta es la hoja que subes a PISIS.** Copia y pega los datos (sin el header bold) en el formato que PISIS te pida.

### Hoja 2: "Incompletas"

Estas son citas que entran en el filtro pero les falta algún dato obligatorio. Tienen las mismas 12 columnas + una columna extra **FALTANTES** que te dice qué falta (ej. "fecha_nacimiento, gender, codigo_eapb").

**Las celdas vacías obligatorias están resaltadas en rojo soft** para que las veas rápido.

**Cómo arreglarlas:**
1. Identifica el paciente (PRIMER_NOMBRE + PRIMER_APELLIDO)
2. Abre el paciente en el dashboard
3. Edita el form de paciente, completa los campos faltantes
4. Re-genera el reporte → la cita se mueve a "Listas para PISIS"

### Campo CODIGO EAPB

Para pacientes con EPS/Prepagada, es el código MinSalud de la aseguradora (ej. `EPS037` = Nueva EPS, `PRE003` = Coomeva Prepagada).
Para pacientes particulares, es la cadena `NA`.

El sistema asigna el código automáticamente cuando:
1. El paciente tiene el campo `Código EAPB` lleno en su form, O
2. El paciente tiene `EPS` lleno en su form (Y la lista de aseguradoras conocidas reconoce el nombre), O
3. La cita tiene `Aseguradora` lleno (similar lookup)

Si ninguno aplica y el `payment_type` es `Particular`, queda `NA`. Si nada de eso, queda vacío y la cita va a "Incompletas".

---

## Reglas del filtro (lo que decide quién entra)

Una cita **entra al reporte** si cumple TODO:
1. Pertenece a tu clínica (filtro por `clinic_id`)
2. Estado: `confirmed`, `rescheduled` o `completed` (no canceladas ni no-shows)
3. `payment_type` NO es `Póliza` ni `SOAT` (excluidos por la Resolución 256, art. 2)
4. La fecha de la cita (`starts_at`) cae en el rango pedido
5. El tipo de consulta está clasificado como **Ginecología**, **Obstetricia**, **Ecografía** o **Resonancia Magnética** (no `NoAplica`, no sin clasificar)

Luego se aplica **dedup primera-del-año**:
- Ginecología y Obstetricia: solo la primera cita del año de cada paciente
- Ecografía y Resonancia: todas las citas pasan

---

## Limitaciones actuales (Fase 1)

### ⚠️ Citas históricas importadas de iSalud no aparecen

Las citas que vinieron de iSalud (la sync con tu sistema viejo) tienen los datos demográficos del paciente dentro de un campo `external_data` en formato JSON, **NO** en las columnas estándar del paciente. Por eso:

- Estas citas tienen `consultation_type_id = NULL` → el reporte las filtra fuera
- No tienen `birth_date`, `gender`, `eapb_code` en el paciente → incluso si las clasificáramos, irían a "Incompletas"

**Lo que esto significa para Algia hoy (junio 2026):**
- Tus ~498 citas históricas de iSalud no aparecen en el reporte
- Solo las citas creadas dentro de Omuwan (vía WhatsApp o el form del dashboard) aparecen
- Si necesitas reportar el semestre 1 de 2026 completo, los datos van a estar incompletos hasta que mejoremos la sync

**Plan para mañana / Fase 2:**
1. Mejorar el importador de iSalud (`src/lib/isalud/`) para que parse los campos demográficos desde `external_data.nombre_paciente`, `external_data.identificacion`, `external_data.aseguradora`, etc., y los persiste en las columnas estándar del paciente.
2. Agregar tabla `appointment_res256_complement` para que Lady complete manualmente birth_date / gender / requested_at / desired_at por cita iSalud.
3. UI en `/dashboard/reportes/resolucion-256/completar-historico` para batch-complete esas citas.

Esto queda anotado en `docs/superpowers/plans/2026-06-06-resolucion-256.md` como Fase 2.

### Otras limitaciones

- La lista de códigos EAPB es un seed estático de ~20 (las EPS y prepagadas comunes en Colombia). Si tu clínica trabaja con una EAPB rara que no está, ahora el sistema la deja vacía → la cita va a "Incompletas". Fase 2 agrega UI para que admines códigos.
- No hay validación de cédula contra Registraduría — el sistema asume que lo que escribiste es correcto. PISIS sí valida; si una cédula es inválida, PISIS rechaza el row.
- Las fechas son en zona horaria Colombia (UTC-5). Si una cita está a las 11 PM hora Colombia y la convertís en UTC, podría parecer del día siguiente. El sistema usa COT consistentemente.

---

## PRÓXIMO (planificado para mañana)

> Mejorar sync iSalud para parsear campos Res-256 (birth_date, gender, eapb_code, requested_at, res256_category) desde `external_data` antes del sync real de Algia.

Esto es prerequisito para que el reporte cubra las 498 citas históricas. Sin esto, Lady tiene que ingresar los datos a mano por cada cita iSalud (no viable a escala).

Detalle del plan en `docs/superpowers/plans/2026-06-06-resolucion-256.md` Fase 2.

---

## Resumen para Lady en 30 segundos

1. **Hoy (una sola vez):** entra a Configuración → Clasificación Res-256, click en "Seleccionar todos con sugerencia" → "Aplicar". Para los ~4 tipos sin sugerencia, abrí el dropdown y elegí. Listo.
2. **Cada semestre:** entrá a Reportes → Resolución 256, click descargar.
3. **Si hay incompletas:** revisá la 2da hoja del Excel, completá los datos faltantes en cada paciente, regenerá.
4. **Sube la 1ra hoja a PISIS.**

---

## Códigos EAPB seed disponibles en Fase 1

| Código | Nombre | Tipo |
|---|---|---|
| EPS037 | Nueva EPS | EPS |
| EPS010 | Salud Total | EPS |
| EPS017 | Famisanar | EPS |
| EPS023 | Compensar | EPS |
| EPS016 | Coomeva EPS | EPS (liquidada 2022 — histórico) |
| EPS002 | SOS | EPS |
| EPS018 | Sanitas EPS | EPS |
| EPS005 | Sura EPS | EPS |
| EPS012 | Coosalud | EPS |
| EPS015 | Aliansalud | EPS |
| EPS013 | Comfenalco | EPS |
| EPS022 | Mutual Ser | EPS |
| PRE001 | Colsanitas | Prepagada |
| PRE002 | Sura Prepagada | Prepagada |
| PRE003 | Coomeva Prepagada | Prepagada |
| PRE004 | Colmédica | Prepagada |
| PRE005 | Allianz Salud | Prepagada |
| PRE006 | AXA Colpatria Prepagada | Prepagada |
| PRE007 | MediPlus | Prepagada |
| NA | (particular) | — |

Si necesitás una aseguradora que no está en esta lista (por ejemplo Cruz Blanca, Saludcoop) pasame el nombre exacto y el código MinSalud para agregarlo en Fase 2.
