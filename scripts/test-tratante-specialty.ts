/**
 * Tests PUROS — tratante por especialidad: normalización, derivación por
 * especialidad, precedencia (derive no pisa humano), resolución + drift.
 * Run: npx tsx scripts/test-tratante-specialty.ts
 */
import {
  normalizeSpecialtyKey, deriveTratantesBySpecialty, mergeTratantesRespectingSource,
  resolveActiveTratantes, type TratantesMap, type DoctorInfo,
} from '../src/lib/isalud/tratante-specialty'
import type { DerivRow } from '../src/lib/isalud/entidad-tratante-derivation'

let pass = 0, fail = 0
function assert(label: string, ok: boolean, got?: unknown): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label} — got: ${JSON.stringify(got)}`); fail++ }
}
function row(o: Partial<DerivRow> & { fecha: string; isalud_agenda_id: number }): DerivRow {
  return { aseguradora: null, profesional: null, servicio: null, procedimiento: null, inicio: null, ...o }
}

console.log('Tests — tratante por especialidad\n')

// --- normalizeSpecialtyKey: MISMA función escritura/lectura ---
assert('Ginecología → GINECOLOGIA', normalizeSpecialtyKey('Ginecología') === 'GINECOLOGIA')
assert('  fisioterapia  → FISIOTERAPIA', normalizeSpecialtyKey('  fisioterapia  ') === 'FISIOTERAPIA')
assert('doble espacio colapsa', normalizeSpecialtyKey('Medicina  General') === 'MEDICINA GENERAL')
assert('null → ""', normalizeSpecialtyKey(null) === '')

// --- deriveTratantesBySpecialty: uno por especialidad, más reciente ---
const resolveDoc = (name: string): { id: string; specialty: string | null } | null => ({
  'Lina Grajales': { id: 'D_LINA', specialty: 'Fisioterapia' },
  'Juan Diego Villegas': { id: 'D_JD', specialty: 'Ginecología' },
  'Otro Gineco': { id: 'D_OTRO', specialty: 'Ginecología' },
}[name] ?? null)

const rows: DerivRow[] = [
  row({ fecha: '2024-01-01', isalud_agenda_id: 1, servicio: 'CONSULTA GINECOLOGIA', profesional: 'Otro Gineco' }),
  row({ fecha: '2026-05-01', isalud_agenda_id: 2, servicio: 'CONSULTA GINECOLOGIA', profesional: 'Juan Diego Villegas' }),
  row({ fecha: '2026-03-01', isalud_agenda_id: 3, servicio: 'CONSULTA FISIOTERAPIA', profesional: 'Lina Grajales' }),
  row({ fecha: '2025-01-01', isalud_agenda_id: 4, servicio: 'ECOGRAFIA', profesional: 'Juan Diego Villegas' }), // procedimiento, no cuenta
]
const derived = deriveTratantesBySpecialty(rows, resolveDoc, '2026-07-31T00:00:00Z')
assert('dos especialidades derivadas', Object.keys(derived).sort().join(',') === 'FISIOTERAPIA,GINECOLOGIA', Object.keys(derived))
assert('gineco = médico de la consulta MÁS reciente (JD, no Otro)', derived['GINECOLOGIA'].doctor_id === 'D_JD')
assert('fisio = Lina', derived['FISIOTERAPIA'].doctor_id === 'D_LINA')
assert('todas source=isalud', Object.values(derived).every((e) => e.source === 'isalud'))

// --- mergeTratantesRespectingSource: el derive NO pisa lo humano ---
const existing: TratantesMap = {
  FISIOTERAPIA: { doctor_id: 'D_SECRE', source: 'secretaria', updated_at: '2026-07-20T00:00:00Z' },
}
const merged = mergeTratantesRespectingSource(existing, derived)
assert('FISIOTERAPIA de secretaria se PRESERVA (no la pisa isalud)', merged['FISIOTERAPIA'].doctor_id === 'D_SECRE' && merged['FISIOTERAPIA'].source === 'secretaria')
assert('GINECOLOGIA (nueva, isalud) sí se agrega', merged['GINECOLOGIA'].doctor_id === 'D_JD')
// y una entrada 'paciente' también se respeta
const merged2 = mergeTratantesRespectingSource({ GINECOLOGIA: { doctor_id: 'D_PAC', source: 'paciente', updated_at: 'x' } }, derived)
assert('GINECOLOGIA de paciente se PRESERVA', merged2['GINECOLOGIA'].doctor_id === 'D_PAC')

// --- resolveActiveTratantes: activo / inactivo / drift / borrado ---
const doctorsById = new Map<string, DoctorInfo>([
  ['D_JD', { id: 'D_JD', name: 'Juan Diego Villegas', specialty: 'Ginecología', is_active: true, agenda_closed: false }],
  ['D_LINA', { id: 'D_LINA', name: 'Lina Grajales', specialty: 'Fisioterapia', is_active: false, agenda_closed: false }], // inactiva
])
const tratantes: TratantesMap = {
  GINECOLOGIA: { doctor_id: 'D_JD', source: 'isalud', updated_at: 'x' },
  FISIOTERAPIA: { doctor_id: 'D_LINA', source: 'isalud', updated_at: 'x' },
  RADIOLOGIA: { doctor_id: 'D_BORRADO', source: 'isalud', updated_at: 'x' }, // médico no existe
}
const res = resolveActiveTratantes(tratantes, doctorsById)
assert('activo se incluye (gineco JD)', res.active.length === 1 && res.active[0].doctor_id === 'D_JD')
assert('inactivo se descarta SIN miss (esperado)', !res.misses.some((m) => m.key === 'FISIOTERAPIA'))
assert('médico borrado → miss doctor_no_existe', res.misses.some((m) => m.key === 'RADIOLOGIA' && m.reason === 'doctor_no_existe'))

// drift: clave guardada no coincide con la especialidad actual del médico activo
const driftDoctors = new Map<string, DoctorInfo>([['D_JD', { id: 'D_JD', name: 'JD', specialty: 'Ginecología y Obstetricia', is_active: true, agenda_closed: false }]])
const driftRes = resolveActiveTratantes({ GINECOLOGIA: { doctor_id: 'D_JD', source: 'isalud', updated_at: 'x' } }, driftDoctors)
assert('DRIFT: clave GINECOLOGIA vs "Ginecología y Obstetricia" → miss visible', driftRes.misses.some((m) => m.reason === 'key_drift'))
assert('DRIFT: igual se usa (label = especialidad actual)', driftRes.active.length === 1 && driftRes.active[0].specialty === 'Ginecología y Obstetricia')

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
