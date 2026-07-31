# Extracción del histórico iSalud (entidad + tratante) — Plan

> **Migración Algia, un solo uso** (ver CLAUDE.md). Standalone (no Vercel). No se generaliza. Fecha de caducidad: cuando Algia corte iSalud.

**Objetivo:** traer las filas del histórico de iSalud a Omuwan antes de cortar iSalud, y derivar por paciente la **entidad** (aseguradora más reciente) y el **tratante** (profesional de la consulta más reciente), con la derivación re-ejecutable sin re-scrapear.

**Contexto técnico confirmado (probes read-only 2026-07-30):**
- Endpoint: `POST /historiaclinica.php/agenda/historicoAjax/action`, DataTables server-side, responde `{recordsTotal, recordsFiltered, data:[...]}`.
- Campos JSON por fila: `id, identificacion, nombre, aseguradora, profesional, servicio, procedimiento, punto_atencion, fecha, inicio, fin, fase`.
- **Eje = documento** (POST directo con `filtro_documento` + `filtro_fases=-1`). Confirmado. `filtro_fecha` NO funciona por POST directo (ningún formato/param) → descartado el eje por fecha.
- Paginación `start`/`length` (length hasta 100). Un paciente entra casi siempre en 1 página.

## Global Constraints
- Filtrar SIEMPRE por `clinic_id` (Algia `dac775fe-6ebd-47e3-89b4-eeb1a821facb`).
- Idempotente (UPSERT por `UNIQUE(clinic_id, isalud_agenda_id)`) + reanudable (checkpoint por cédula).
- Rate limit ≥ 1.5s entre requests. Re-login si la sesión rebota.
- **Reporte de cierre contrastable** en cada corrida: cédulas procesadas, con 0 filas, con error, filas insertadas, y tras derivar: pacientes con entidad y con tratante. Números reales.
- La entidad derivada va a **`patients.entidad_isalud`** (texto crudo). **NO** tocar `patients.eps` (alimenta Res-256). Promover a eps queda para después con mapeo deliberado.
- Zona horaria America/Bogota. TS estricto.

## Esquema — migración `000NN_isalud_historico.sql`

```sql
CREATE TABLE isalud_historico_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  isalud_agenda_id bigint NOT NULL,
  documento text NOT NULL,
  nombre text, aseguradora text, profesional text,
  servicio text, procedimiento text, cq text,
  fecha date, inicio time, fin time, fase text,
  raw_json jsonb,
  scraped_at timestamptz DEFAULT now(),
  UNIQUE (clinic_id, isalud_agenda_id)
);
CREATE INDEX idx_hist_rows_clinic_doc ON isalud_historico_rows(clinic_id, documento);

CREATE TABLE isalud_historico_scrape_log (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  documento text NOT NULL,
  scraped_at timestamptz DEFAULT now(),
  row_count int DEFAULT 0,
  ok boolean DEFAULT true,
  error text,
  PRIMARY KEY (clinic_id, documento)
);

ALTER TABLE patients ADD COLUMN entidad_isalud text;
ALTER TABLE patients ADD COLUMN tratante_doctor_id uuid REFERENCES doctors(id) ON DELETE SET NULL;

ALTER TABLE isalud_historico_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE isalud_historico_scrape_log ENABLE ROW LEVEL SECURITY;
```

## Módulos

### `src/lib/isalud/historico-scraper.ts`
- `buildHistoricoPostBody(documento, {start,length}) → Record<string,string>` — el body DataTables mínimo (columna 0 + start/length + `filtro_documento` + `filtro_fases='-1'`).
- `parseHistoricoRow(json, clinicId) → HistoricoRow` — mapea los campos JSON al schema (`id→isalud_agenda_id`, `identificacion→documento`, `punto_atencion→cq`, …), guarda `raw_json`.
- `fetchHistoricoForDocumento(page, base, documento) → HistoricoRow[]` — POST(s) paginado(s), devuelve filas parseadas. Tests puros para `buildHistoricoPostBody` + `parseHistoricoRow`.

### `src/lib/isalud/entidad-tratante-derivation.ts` (PURO, testeado)
- `classifyServicio(servicio, procedimiento, catalog) → 'consulta' | 'procedimiento'` — contra el catálogo (`consultation_types`) + fallback keyword (`CONSULTA*/CONTROL*/VALORACION* → consulta`). Ajustable.
- `deriveEntidad(rows) → string | null` — aseguradora de la fila **más reciente** (orden `fecha` desc, desempate `inicio`/`isalud_agenda_id`). NO la más frecuente.
- `deriveTratante(rows, catalog) → string | null` — profesional de la fila-**consulta** más reciente.
- Tests: caso "cambió de EPS" (vieja frecuente vs nueva reciente → gana reciente); tratante ignora procedimientos; sin consultas → tratante null.

### `scripts/scrape-isalud-historico.ts` (orquestador)
- `--patients-imported` (corrida 1): itera las cédulas de `patients` con `clinic_id=Algia` (los 491 importados) que NO estén en `scrape_log`.
- `--all` (corrida 2): itera las cédulas de la lista de clientes (cache `~/.omuwan-cache/algia-clientes` o tabla), rate limit alto, reanudable.
- `--derive`: corre solo el job de derivación (sin scrapear).
- Por cédula: `fetchHistoricoForDocumento` → UPSERT filas → escribir `scrape_log`. Re-login on bounce. Rate limit. Progreso cada N a stdout.
- Al cerrar: **reporte contrastable** (contadores reales) + query de verificación de `patients` con entidad/tratante.

### Job de derivación (dentro del script, `--derive` y al final de cada corrida)
- Por cada `documento` con filas: `deriveEntidad` + `deriveTratante`; matchea el nombre del profesional a `doctors` con `name-matcher.ts` (ya existe); UPDATE `patients.entidad_isalud` + `tratante_doctor_id`. Re-ejecutable.

## Orden de ejecución
1. Migración (schema). Verificar columnas.
2. ✅ Test `filtro_fecha` por POST directo — **hecho, no funciona → eje documento**.
3. Módulos + tests puros verdes.
4. **Corrida 1** (491) → filas → derivar → reporte de cierre. Entidad lista para go-live.
5. Corrida 2 (resto) nocturna, reanudable → filas → re-derivar.
