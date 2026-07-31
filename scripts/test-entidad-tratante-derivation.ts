/**
 * Tests PUROS — derivación entidad (más reciente) + tratante (consulta) +
 * clasificación consulta/procedimiento. Sin DB.
 * Run: npx tsx scripts/test-entidad-tratante-derivation.ts
 */
import { classifyServicio, deriveEntidad, deriveTratante, appointmentToDerivRow, type DerivRow } from '../src/lib/isalud/entidad-tratante-derivation'

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

// --- deriveTratante: consulta más reciente por MÉDICO ACTIVO (dos condiciones) ---
// resolver: solo estos nombres son médicos activos; el resto (staff, radiólogo, inactivos) → null.
const resolve = (name: string): string | null => ({
  'Juan Diego Villegas Echeverri': 'DOC_JD',
  'Nuevo Medico': 'DOC_NUEVO',
  'Viejo Medico': 'DOC_VIEJO',
}[name] ?? null)

// La fila más reciente es un procedimiento (ecografía por radiólogo, no-activo);
// la consulta más reciente es más vieja (Villegas, activo). Tratante = Villegas.
const conProc: DerivRow[] = [
  row({ fecha: '2026-01-23', isalud_agenda_id: 100, servicio: 'CONSULTA GINECOLOGIA', profesional: 'Juan Diego Villegas Echeverri' }),
  row({ fecha: '2026-06-10', isalud_agenda_id: 200, servicio: 'ECOGRAFIA DE MAPEO', profesional: 'Otro Radiologo' }),
]
assert('tratante = consulta de médico activo (Villegas → DOC_JD), ignora procedimiento',
  deriveTratante(conProc, resolve) === 'DOC_JD')
assert('sin consultas → tratante null',
  deriveTratante([row({ fecha: '2026-06-10', isalud_agenda_id: 1, servicio: 'COLPOSCOPIA', profesional: 'Juan Diego Villegas Echeverri' })], resolve) === null)
assert('entre dos consultas de médicos activos gana la más reciente',
  deriveTratante([
    row({ fecha: '2025-01-01', isalud_agenda_id: 1, servicio: 'CONSULTA', profesional: 'Viejo Medico' }),
    row({ fecha: '2026-01-01', isalud_agenda_id: 2, servicio: 'CONSULTA', profesional: 'Nuevo Medico' }),
  ], resolve) === 'DOC_NUEVO')
// Consulta MÁS reciente por staff/no-activo → se saltea, cae a la consulta previa de médico activo.
assert('consulta reciente por no-médico se saltea → consulta previa de médico activo',
  deriveTratante([
    row({ fecha: '2025-05-01', isalud_agenda_id: 1, servicio: 'CONSULTA', profesional: 'Juan Diego Villegas Echeverri' }),
    row({ fecha: '2026-05-01', isalud_agenda_id: 2, servicio: 'CONTROL ENTREGA RESULTADOS', profesional: 'Lady Yuliana Acevedo Lopez' }),
  ], resolve) === 'DOC_JD')

// --- adaptador appointmentToDerivRow (pasado iSalud + presente citas Omuwan) ---
assert('cita cancelada → adapter null (no define tratante)',
  appointmentToDerivRow({ id: 'a', doctor_name: 'Nuevo Medico', servicio: 'CONSULTA', starts_at: '2026-07-01T13:00:00Z', status: 'cancelled' }) === null)
assert('no_show → adapter null',
  appointmentToDerivRow({ id: 'a', doctor_name: 'Nuevo Medico', servicio: 'CONSULTA', starts_at: '2026-07-01T13:00:00Z', status: 'no_show' }) === null)
const apptRow = appointmentToDerivRow({ id: 'a', doctor_name: 'Nuevo Medico', servicio: 'CONSULTA GINECOLOGIA', starts_at: '2026-07-01T13:00:00Z', status: 'confirmed' })!
assert('cita confirmada → DerivRow con profesional+servicio', apptRow.profesional === 'Nuevo Medico' && apptRow.servicio === 'CONSULTA GINECOLOGIA')
assert('tratante: cita Omuwan (presente) le gana a consulta iSalud vieja',
  deriveTratante([
    row({ fecha: '2025-01-01', isalud_agenda_id: 1, servicio: 'CONSULTA', profesional: 'Juan Diego Villegas Echeverri' }),
    apptRow,
  ], resolve) === 'DOC_NUEVO')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
