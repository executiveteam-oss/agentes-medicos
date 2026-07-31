// ============================================================
// ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
//
// Scrape del histórico de iSalud por DOCUMENTO vía el endpoint DataTables
// server-side: POST /historiaclinica.php/agenda/historicoAjax/action.
// Eje documento confirmado; filtro_fecha por POST directo NO funciona.
// ============================================================
import type { Page } from 'playwright-core'

export interface HistoricoRow {
  isalud_agenda_id: number
  documento: string
  nombre: string | null
  aseguradora: string | null
  profesional: string | null
  servicio: string | null
  procedimiento: string | null
  cq: string | null
  fecha: string | null      // YYYY-MM-DD
  inicio: string | null     // HH:MM:SS
  fin: string | null
  fase: string | null
  raw_json: Record<string, unknown>
}

const AJAX_PATH = '/historiaclinica.php/agenda/historicoAjax/action'

/** Body DataTables mínimo para filtrar por documento (paginado start/length). */
export function buildHistoricoPostBody(documento: string, opts: { start: number; length: number }): Record<string, string> {
  return {
    draw: '1',
    'columns[0][data]': 'id',
    'columns[0][name]': '',
    'columns[0][searchable]': 'true',
    'columns[0][orderable]': 'true',
    'columns[0][search][value]': '',
    'columns[0][search][regex]': 'false',
    'order[0][column]': '0',
    'order[0][dir]': 'desc',
    'search[value]': '',
    'search[regex]': 'false',
    start: String(opts.start),
    length: String(opts.length),
    filtro_fecha: '',
    filtro_documento: documento,
    filtro_nombre: '',
    filtro_fases: '-1', // Todas
  }
}

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim().replace(/\s+/g, ' ')
  return t === '' ? null : t
}

/** YYYY-MM-DD plausible (año 1900–2100). iSalud a veces manda "-0001-11-30"
 *  (fecha cero) que Postgres rechaza → null. */
function validDate(v: unknown): string | null {
  const t = s(v)
  if (!t) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (!m) return null
  const y = parseInt(m[1], 10)
  return y >= 1900 && y <= 2100 ? t : null
}

/** HH:MM(:SS) válido → null si no. */
function validTime(v: unknown): string | null {
  const t = s(v)
  if (!t) return null
  return /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t) ? t : null
}

/** Mapea una fila cruda del AJAX al schema de isalud_historico_rows. null si sin id. */
export function parseHistoricoRow(json: Record<string, unknown>): HistoricoRow | null {
  const id = parseInt(String(json.id ?? ''), 10)
  if (!Number.isFinite(id)) return null
  return {
    isalud_agenda_id: id,
    documento: s(json.identificacion) ?? '',
    nombre: s(json.nombre),
    aseguradora: s(json.aseguradora),
    profesional: s(json.profesional),
    servicio: s(json.servicio),
    procedimiento: s(json.procedimiento),
    cq: s(json.punto_atencion),
    fecha: validDate(json.fecha),
    inicio: validTime(json.inicio),
    fin: validTime(json.fin),
    fase: s(json.fase),
    // guardamos la fila cruda pero sin el HTML ruidoso
    raw_json: (() => { const r = { ...json }; delete (r as Record<string, unknown>).abrir_otra_pestana; return r })(),
  }
}

/**
 * Trae TODAS las filas del histórico de un documento (paginando si hace falta).
 * Devuelve las filas parseadas. Lanza si el POST falla (para que el caller
 * marque error en el scrape_log y reintente/re-loguee).
 */
export async function fetchHistoricoForDocumento(page: Page, baseUrl: string, documento: string): Promise<HistoricoRow[]> {
  const url = `${baseUrl}${AJAX_PATH}`
  const length = 100
  const rows: HistoricoRow[] = []
  let start = 0
  let total = Infinity
  let guard = 0
  while (start < total && guard < 50) {
    guard++
    const resp = await page.request.post(url, {
      form: buildHistoricoPostBody(documento, { start, length }),
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      timeout: 30000,
    })
    if (!resp.ok()) throw new Error(`historicoAjax status ${resp.status()} (doc ${documento})`)
    const j = (await resp.json()) as { recordsTotal?: number; recordsFiltered?: number; data?: Array<Record<string, unknown>> }
    total = typeof j.recordsFiltered === 'number' ? j.recordsFiltered : (j.recordsTotal ?? 0)
    const data = j.data ?? []
    for (const d of data) { const r = parseHistoricoRow(d); if (r) rows.push(r) }
    if (data.length === 0) break
    start += length
  }
  return rows
}
