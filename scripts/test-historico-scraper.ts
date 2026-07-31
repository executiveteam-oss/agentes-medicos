/**
 * Tests PUROS — body del POST + parseo de fila del histórico. Sin red.
 * Run: npx tsx scripts/test-historico-scraper.ts
 */
import { buildHistoricoPostBody, parseHistoricoRow } from '../src/lib/isalud/historico-scraper'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('Tests — historico-scraper (body + parseo)\n')

const b = buildHistoricoPostBody('42119415', { start: 100, length: 100 })
assert('filtro_documento seteado', b.filtro_documento === '42119415')
assert('filtro_fases = -1 (Todas)', b.filtro_fases === '-1')
assert('start/length como string', b.start === '100' && b.length === '100')
assert('order desc por columna 0', b['order[0][column]'] === '0' && b['order[0][dir]'] === 'desc')

const raw = {
  DT_RowClass: 'historico-morado',
  url: '/historiaclinica.php/agenda/52450/edit',
  id: '52450',
  abrir_otra_pestana: '<a href="...">html ruidoso</a>',
  identificacion: '42119415',
  nombre: 'Maria  Teresa Echavarria Abad',
  aseguradora: 'MEDPLUS MEDICINA PREPAGADA',
  profesional: 'Juan Diego Villegas Echeverri',
  servicio: 'CONTROL ENTREGA RESULTADOS',
  procedimiento: 'Consulta entrega de resultados',
  punto_atencion: 'Consultorio 3 Oval',
  fecha: '2026-05-07', inicio: '09:30:00', fin: '09:50:00', fase: 'Facturado',
}
const r = parseHistoricoRow(raw)!
assert('id → isalud_agenda_id (número)', r.isalud_agenda_id === 52450)
assert('identificacion → documento', r.documento === '42119415')
assert('nombre colapsa espacios dobles', r.nombre === 'Maria Teresa Echavarria Abad')
assert('punto_atencion → cq', r.cq === 'Consultorio 3 Oval')
assert('mapea aseguradora/profesional/servicio/procedimiento/fecha/fase',
  r.aseguradora === 'MEDPLUS MEDICINA PREPAGADA' && r.profesional === 'Juan Diego Villegas Echeverri' &&
  r.servicio === 'CONTROL ENTREGA RESULTADOS' && r.procedimiento === 'Consulta entrega de resultados' &&
  r.fecha === '2026-05-07' && r.fase === 'Facturado')
assert('raw_json conserva campos pero SIN el HTML abrir_otra_pestana',
  (r.raw_json as Record<string, unknown>).abrir_otra_pestana === undefined && (r.raw_json as Record<string, unknown>).id === '52450')
assert('fila sin id → null', parseHistoricoRow({ identificacion: '1' }) === null)

const basura = parseHistoricoRow({ id: '99', identificacion: '1', fecha: '-0001-11-30', inicio: '99:99:99', fin: '' })!
assert('fecha basura "-0001-11-30" → null', basura.fecha === null)
assert('hora inválida "99:99:99" → null', basura.inicio === null)
const okDate = parseHistoricoRow({ id: '100', identificacion: '1', fecha: '2026-05-07', inicio: '09:30:00' })!
assert('fecha/hora válidas se conservan', okDate.fecha === '2026-05-07' && okDate.inicio === '09:30:00')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
