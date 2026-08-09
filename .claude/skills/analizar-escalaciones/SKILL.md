---
name: analizar-escalaciones
description: Use cuando haya que entender por qué el agente de Omuwan escaló conversaciones a un humano en un período — qué las disparó, cuáles eran evitables y qué faltaría para que no escalen. Corre EN LOTE sobre un rango de fechas, nunca sobre una conversación suelta.
---

# Analizar escalaciones de Omuwan

Una escalación sola no dice nada. Puede haber sido correcta, puede haber sido un
accidente, y desde adentro se ven iguales. **El patrón sí dice.** Por eso esta
skill corre sobre un rango de fechas y produce un informe agrupado, no una
lectura caso por caso.

## Cómo corre

```bash
npx tsx .claude/skills/analizar-escalaciones/extraer.ts <desde> <hasta>
# ej: npx tsx .claude/skills/analizar-escalaciones/extraer.ts 2026-08-10 2026-08-16
```

Fechas `YYYY-MM-DD`, en COT, inclusive de punta a punta. Deja un JSON en
`.claude/skills/analizar-escalaciones/datos-<desde>_<hasta>.json`.

El extractor **no opina**: junta, resuelve los joins rotos, y marca qué sabe y
qué no. Todo el juicio lo hacés vos leyendo las transcripciones que deja
servidas. Esa frontera la pone el código a propósito — si el mismo paso que
junta los datos es el que los interpreta, no hay forma de distinguir después un
motivo leído de uno adivinado.

---

## ⚠️ ANTES DE ESCRIBIR UNA SOLA CONCLUSIÓN

El JSON trae `meta.suficiencia`. **Obedecela, y ponela como primera línea del
informe.**

| Valor | Casos | Qué podés decir |
|---|---|---|
| `INSUFICIENTE` | < 15 | **Nada.** Describí los casos uno por uno como anécdotas y decí explícitamente que no alcanzan para concluir. No armes porcentajes: "2 de 5 = 40%" con n=5 es una mentira con formato de dato. |
| `PRELIMINAR` | 15–39 | Señales, con la palabra "preliminar" en cada afirmación agregada. Nada de priorizar roadmap con esto. |
| `SUFICIENTE` | ≥ 40 | Agrupar, ordenar por frecuencia y recomendar. |

Y dentro de cada grupo: **un grupo con menos de 3 casos (`GRUPO_MINIMO`) no es
un patrón, es una coincidencia.** Reportalo igual, pero marcado como tal.

Nunca conviertas conteos chicos en porcentajes sin mostrar el crudo al lado:
`3 de 47 (6%)`, nunca `6%` solo.

---

## Lo que sabés vs. lo que estás adivinando

Cada caso trae `confianza`:

- **`leido`** — el motivo salió del campo `escalation_reason`, que es un conjunto
  cerrado (`src/lib/conversations/escalation-reasons.ts`). Es un hecho.
- **`inferido`** — no había motivo estampado, o había prosa vieja. Lo tenés que
  deducir leyendo la conversación. `por_que_inferido` explica por qué.

**Esta distinción va en el informe, siempre.** En el encabezado (`X leídos, Y
inferidos`) y en cada grupo (`de los N de este grupo, M son inferidos`).

Un grupo hecho mayormente de motivos inferidos es una hipótesis tuya, no una
medición. Decilo con esas palabras.

Los casos con `fecha_estimada: true` tienen fecha del evento de auditoría, no de
`escalated_at` — sirven para ubicar, no para medir tiempos finos.

---

## La rúbrica — los cinco puntos, por cada escalación

### 1. Qué la disparó
Sale de los campos, no de tu lectura: `motivo`, `mecanismo`, `etiqueta`,
`detalle`. Los mecanismos son `capa_0`, `keyword`, `tool_agente`,
`falla_tecnica`, `documento`, `humano`.

Si `confianza` es `inferido`, decilo acá y explicá de qué parte del texto lo
dedujiste.

### 2. Qué quería la paciente
**Leído de SUS mensajes, no del motivo registrado.** El motivo dice qué mecanismo
se disparó; no dice qué necesitaba ella. Con frecuencia no coinciden: el motivo
puede decir `servicio_escalate_human` y ella estar preguntando un precio.

Citá textual. Una frase de ella, entre comillas.

### 3. ¿Hacía falta un humano de verdad?
Clasificá en exactamente una:

- **`criterio_clinico`** — hace falta el juicio de una persona con formación.
  Contraindicación, síntoma que hay que evaluar, decisión sobre un procedimiento.
  **NO evitable.**
- **`logistica_agente`** — es coordinación que el agente podría hacer si supiera
  algo más o tuviera una tool más. Cambiar un horario, informar un requisito,
  decir un precio. **Evitable.**
- **`falso_positivo`** — no hacía falta nadie. El detector se disparó de más.
  **Evitable.**

Ante la duda entre `criterio_clinico` y `logistica_agente`, **elegí
`criterio_clinico`**. Es el sesgo seguro: contar de menos las evitables produce
un roadmap tímido; contar de más produce un cambio que le saca a una paciente el
humano que necesitaba.

### 4. Qué habría hecho falta para que el agente la resolviera solo
Concreto y accionable. No "mejorar el prompt".

Mirá `tools_del_turno` y los `tools` de cada turno del agente: dicen qué
**intentó**. No es lo mismo "llamó `check_availability`, no había cupo y escaló"
que "nunca la llamó". El primero es un problema de agenda; el segundo, del
modelo.

Las formas válidas de respuesta acá:
- un dato que no está en el contexto del agente (y en qué tabla debería vivir)
- una tool que no existe
- una regla del catálogo mal configurada
- una keyword que sobra
- estructura determinista faltante (patrón 1 del CLAUDE.md: si tiene que pasar,
  no puede depender de que el modelo lea una instrucción)

### 5. ¿HUBO FRICCIÓN PREVIA? — obligatorio, en todos los casos

**Este punto no se saltea nunca, ni siquiera en las escalaciones que parecen
obvias.**

Si la paciente pidió un humano **después** de que el agente la maltratara, la
causa real es el maltrato, no el pedido. Una escalación con motivo
`pedido_humano` o `escalate_to_human` precedida de fricción **no se cuenta como
"la paciente quería un humano"** — se cuenta como fricción del agente, y se
clasifica `logistica_agente` (evitable).

Señales concretas a buscar en los turnos previos:

- el agente **pidió un dato que ella ya había dado**
- el agente pidió datos **de más** para la tarea (correo, fecha de nacimiento,
  documento, cuando no hacían falta todavía)
- el agente **repitió la misma pregunta** después de que ella contestara
- el agente **no entendió**: reformuló, dijo que no comprendía, o contestó otra cosa
- el agente tiró **una lista larga sin numerar** y ella tuvo que elegir a ciegas
- **ella se repitió** — el mismo pedido dos veces con otras palabras
- señales de fastidio: mayúsculas, "ya te dije", "otra vez", signos repetidos
- muchos turnos para algo simple (contá los turnos hasta la escalación)

En el informe, por cada caso: **`fricción: sí/no`**, y si es sí, **en qué turno
empezó** y qué la produjo.

---

## Taxonomía

**PROVISIONAL — salió de cuatro casos reales de una sola semana.** No la trates
como cerrada. Si un caso no entra cómodo, **no lo fuerces**: creá una categoría
nueva o dejalo sin clasificar.

| # | Categoría | Qué es |
|---|---|---|
| 1 | **Servicio ruleado legítimo, conversación muerta** | La regla del catálogo actuó bien, pero la conversación quedó inservible para todo lo demás. Caso real: pidió mapeo → se marcó; después preguntó por una transvaginal → nadie le contestó. |
| 2 | **Falso positivo del detector** | Un detector de Capa 0 se disparó con algo que no era. Caso real: una pregunta de precio escaló el servicio. |
| 3 | **Fricción del agente** | Pidió humano después de que el agente le pidiera datos de más, la insistiera o no la entendiera. Caso real: pidió "Asesor" después de que le pidieran correo y fecha de nacimiento. |
| 4 | **Vocabulario de keyword** | Una palabra de uso corriente en la clínica está en la lista de escalación. Caso real: `"médico"` disparó una escalación. Mirá `meta.keywords_configuradas` — para una clínica de dolor pélvico, `"dolor"` en esa lista alcanza a casi toda paciente. |

**Reportá siempre `sin_clasificar`: cuántos casos no entraron en ninguna
categoría, ni provisional ni nueva.** Ese número es el que dice si la taxonomía
sirve:

- 0 sin clasificar con muestra grande → sospechá que estás forzando casos
- muchos sin clasificar → la taxonomía se quedó corta, hay que rehacerla

Cuando crees una categoría nueva, dale nombre, definila en una línea, y decí de
qué casos salió.

---

## El informe

Markdown. Este orden.

### Encabezado
```
Escalaciones del <desde> al <hasta>
N casos · suficiencia: <INSUFICIENTE|PRELIMINAR|SUFICIENTE>
Motivo leído: X · Motivo inferido: Y
Demo excluidas: Z · Eventos sin vincular: W
```

Si hay `mensajes_posiblemente_truncados > 0`, avisá: hay mensajes en el techo de
1.000 caracteres del sanitizador y pueden estar cortados.

### El número que resume todo
```
EVITABLES: N de M  (logistica_agente + falso_positivo)
```
Crudo y porcentaje juntos. Si la suficiencia es `INSUFICIENTE`, **poné el crudo
solo y escribí "muestra insuficiente para porcentaje"**.

### Grupos, ordenados por frecuencia (más frecuente primero)

Por cada grupo:
- **Nombre y tamaño** — `N casos (M inferidos)`
- **Qué tienen en común** — una frase
- **Un caso ejemplar** — con cita textual de la paciente
- **Evitables dentro del grupo** — cuántos y por qué
- **Fricción** — en cuántos hubo
- **UNA recomendación** — concreta, accionable, con el archivo o la tabla que
  habría que tocar. Una sola: si tenés tres ideas, elegí la que más casos
  resuelve y mencioná las otras como alternativa en una línea.

### Sin clasificar
Cuántos, y qué tenían de raro.

### Lo que este informe NO puede decir
Explícito. Qué quedó fuera del alcance: motivos inferidos, eventos sin vincular,
mensajes truncados, tamaño de muestra, ventanas de tiempo sin tráfico.

---

## Reglas de la casa que aplican acá

- **No generalices desde una muestra chica.** Es la razón de ser de
  `meta.suficiencia`. Si el informe termina diciendo algo que la muestra no
  aguanta, la skill falló aunque el análisis sea lindo.
- **Si te saltaste algo, decilo explícito.** Un caso que no pudiste analizar
  porque le faltaban datos va listado, no omitido.
- **Recomendaciones de estructura, no de prompt.** Patrón 1 del CLAUDE.md: si
  algo *tiene que* pasar, no puede depender de que el modelo obedezca una
  instrucción. Una recomendación que empieza con "agregar al prompt que…" casi
  siempre es la respuesta equivocada; la pregunta es qué estructura faltaba.
- **No propongas tocar `escalate-service-matcher.ts`.** La lista curada de
  keywords se mantiene como está por decisión del dueño del producto. Si un caso
  sugiere cambiarla, marcalo como hallazgo y dejá que él decida.
- **Nada de datos personales en el informe.** Nombre de pila si hace falta;
  nunca teléfono completo ni documento. Los datos de salud son categoría
  sensible bajo la Ley 1581/2012.
