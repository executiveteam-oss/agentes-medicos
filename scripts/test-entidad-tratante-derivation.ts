/**
 * Tests PUROS — derivación entidad (más reciente) + tratante (consulta) +
 * clasificación consulta/procedimiento. Sin DB.
 * Run: npx tsx scripts/test-entidad-tratante-derivation.ts
 */
import { classifyServicio, deriveEntidad, deriveTratante, type DerivRow } from '../src/lib/isalud/entidad-tratante-derivation'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

function row(o: Partial<DerivRow> & { fecha: string; isalud_agenda_id: number }): DerivRow {
  return { aseguradora: null, profesional: null, servicio: null, procedimiento: null, inicio: null, ...o }
}

console.log('Tests — derivación entidad/tratante\n')

// --- classifyServicio ---
assert('CONSULTA GINECOLOGIA → consulta', classifyServicio('CONSULTA GINECOLOGIA', null) === 'consulta')
assert('CONTROL ENTREGA RESULTADOS → consulta', classifyServicio('CONTROL ENTREGA RESULTADOS', null) === 'consulta')
assert('COLPOSCOPIA → procedimiento', classifyServicio('COLPOSCOPIA', null) === 'procedimiento')
assert('ECOGRAFIA DE MAPEO → procedimiento', classifyServicio('ECOGRAFIA DE MAPEO', null) === 'procedimiento')
assert('servicio vacío → procedimiento', classifyServicio(null, null) === 'procedimiento')
assert('override catálogo: ECOGRAFIA marcada consulta', classifyServicio('ECOGRAFIA X', null, new Set(['ECOGRAFIA X'])) === 'consulta')

// --- deriveEntidad: MÁS RECIENTE, no más frecuente ---
// Paciente que cambió de EPS: vieja (SURA) 3 veces en fechas viejas; nueva (MEDPLUS) 1 vez reciente.
const cambioEps: DerivRow[] = [
  row({ fecha: '2024-02-01', isalud_agenda_id: 10, aseguradora: 'SURA EPS' }),
  row({ fecha: '2024-05-01', isalud_agenda_id: 11, aseguradora: 'SURA EPS' }),
  row({ fecha: '2024-09-01', isalud_agenda_id: 12, aseguradora: 'SURA EPS' }),
  row({ fecha: '2026-05-07', isalud_agenda_id: 52450, aseguradora: 'MEDPLUS MEDICINA PREPAGADA' }),
]
assert('entidad = MÁS RECIENTE (MEDPLUS), no la más frecuente (SURA)', deriveEntidad(cambioEps) === 'MEDPLUS MEDICINA PREPAGADA')
assert('desempate por hora/id el mismo día',
  deriveEntidad([
    row({ fecha: '2026-05-07', inicio: '08:00:00', isalud_agenda_id: 1, aseguradora: 'A' }),
    row({ fecha: '2026-05-07', inicio: '14:00:00', isalud_agenda_id: 2, aseguradora: 'B' }),
  ]) === 'B')
assert('sin aseguradora → null', deriveEntidad([row({ fecha: '2026-01-01', isalud_agenda_id: 1 })]) === null)
assert('sin filas → null', deriveEntidad([]) === null)

// --- deriveTratante: profesional de la CONSULTA más reciente (procedimiento NO define) ---
// La fila MÁS reciente es un procedimiento (ecografía de mapeo por Dr. Radiólogo);
// la consulta más reciente es más vieja (Dr. Villegas). Tratante = Villegas.
const conProc: DerivRow[] = [
  row({ fecha: '2026-01-23', isalud_agenda_id: 100, servicio: 'CONSULTA GINECOLOGIA', profesional: 'Juan Diego Villegas Echeverri' }),
  row({ fecha: '2026-06-10', isalud_agenda_id: 200, servicio: 'ECOGRAFIA DE MAPEO', profesional: 'Otro Radiologo' }),
]
assert('tratante = consulta más reciente (Villegas), ignora el procedimiento más nuevo',
  deriveTratante(conProc) === 'Juan Diego Villegas Echeverri')
assert('sin consultas → tratante null',
  deriveTratante([row({ fecha: '2026-06-10', isalud_agenda_id: 1, servicio: 'COLPOSCOPIA', profesional: 'X' })]) === null)
assert('entre dos consultas gana la más reciente',
  deriveTratante([
    row({ fecha: '2025-01-01', isalud_agenda_id: 1, servicio: 'CONSULTA', profesional: 'Viejo' }),
    row({ fecha: '2026-01-01', isalud_agenda_id: 2, servicio: 'CONSULTA', profesional: 'Nuevo' }),
  ]) === 'Nuevo')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
