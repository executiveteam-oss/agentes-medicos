# Análisis de escalaciones

Un informe por período, fechado. Los genera la skill `analizar-escalaciones`.

```bash
npx tsx .claude/skills/analizar-escalaciones/titular.ts          # el último, con delta
npx tsx .claude/skills/analizar-escalaciones/titular.ts --serie  # la serie entera
```

## Por qué se guardan

El informe de la semana 1 es interesante. **La semana 1 contra la semana 6 es lo
que demuestra que el producto mejoró** — o que no. Eso solo funciona si los
informes quedan, y si los números salen siempre del mismo lugar.

De ahí el frontmatter: es lo que hace la serie comparable sin que nadie tenga que
abrir seis archivos y sumar a mano.

## Convención

Nombre: `YYYY-MM-DD_a_YYYY-MM-DD.md` — el período que cubre, no el día en que se
generó.

Frontmatter obligatorio, exactamente con esta forma (la lee `titular.ts`):

```yaml
---
periodo_desde: 2026-08-17
periodo_hasta: 2026-08-23
total: 47
evitables: 19
suficiencia: SUFICIENTE
motivo_leido: 44
motivo_inferido: 3
sin_clasificar: 2
grupos:
  - clave: friccion_del_agente | casos: 12 | evitables: 12
  - clave: vocabulario_keyword | casos: 9 | evitables: 9
---
```

`clave` en snake_case y **estable entre informes**: si un período la llama
`friccion_del_agente` y el siguiente `friccion_agente`, la serie muestra dos
grupos donde hay uno.

## 🔴 Estos archivos se publican

**El repo es público.** Todo lo que entre acá queda en GitHub, para siempre y
para cualquiera.

Las conversaciones que se analizan son de pacientes de una clínica de dolor
pélvico. Bajo la Ley 1581/2012 eso es dato de salud, **categoría sensible**.

Por eso, en el informe:

- **Nada de citas textuales de la paciente.** Se parafrasea qué quería. Si hace
  falta mostrar la fricción, se cita **al agente** — ese texto es nuestro.
- Sin nombres, sin teléfonos, sin documentos, sin fechas de nacimiento.
- Sin `conversation_id`: es un puntero directo a la conversación.
- Para referirse a un caso: `caso 3 del período`, y listo.

El detalle crudo —con transcripciones completas— vive en el JSON que deja
`extraer.ts`, que está en el `.gitignore` y no sale de la máquina. Quien necesite
leer literal, lo abre ahí.
