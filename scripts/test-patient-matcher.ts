/**
 * Tests del patient-matcher (migración Algia).
 * Cubre los 3 casos: cedula match, phone match, insert + skips por validación.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-patient-matcher.ts
 */

import { matchClienteToPatient, type ExistingPatientLite } from '../src/lib/isalud/patient-matcher'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests patient-matcher\n')

// Pacientes simulados de Omuwan
const existing: ExistingPatientLite[] = [
  { id: 'p1', document_number: '1234567890', phone: '+573101111111', name: 'JUAN GARCIA' },
  { id: 'p2', document_number: null,          phone: '+573102222222', name: 'MARIA LOPEZ' },
  { id: 'p3', document_number: '9876543210', phone: '+573103333333', name: 'PEDRO RAMIREZ' },
]

// ============================================================
// match_by_cedula
// ============================================================
console.log('=== match_by_cedula ===')
{
  const r = matchClienteToPatient(
    { documento: '1234567890', nombre: 'JUAN GARCIA', telefono: '3104444444' },
    existing,
  )
  assert('Match cédula con phone distinto',
    r.type === 'match_by_cedula' && r.existing_patient_id === 'p1')
}
{
  const r = matchClienteToPatient(
    { documento: '1234567890', nombre: 'JUAN GARCIA', telefono: '3101111111' },
    existing,
  )
  assert('Match cédula con mismo phone',
    r.type === 'match_by_cedula' && r.existing_patient_id === 'p1')
}

// ============================================================
// match_by_phone
// ============================================================
console.log('\n=== match_by_phone ===')
{
  const r = matchClienteToPatient(
    { documento: '5555555555', nombre: 'MARIA LOPEZ', telefono: '3102222222' },
    existing,
  )
  assert('Match phone, cédula nueva (p2 no tiene cédula)',
    r.type === 'match_by_phone' && r.existing_patient_id === 'p2')
}
{
  // Phone normalizado: 3102222222 (10 dig empieza con 3) → +573102222222
  const r = matchClienteToPatient(
    { documento: '5555555555', nombre: 'X', telefono: '+57 310 222 2222' },
    existing,
  )
  assert('Match phone con formato espaciado',
    r.type === 'match_by_phone' && r.existing_patient_id === 'p2')
}

// ============================================================
// insert
// ============================================================
console.log('\n=== insert ===')
{
  const r = matchClienteToPatient(
    { documento: '7777777777', nombre: 'LUIS FERNANDEZ', telefono: '3105555555' },
    existing,
  )
  assert('Cédula y phone nuevos → insert',
    r.type === 'insert' && r.normalized_phone === '+573105555555')
}
{
  const r = matchClienteToPatient(
    { documento: '8888888888', nombre: 'ANA GOMEZ', telefono: '3106666666' },
    [],  // sin pacientes existentes
  )
  assert('Insert con DB vacía', r.type === 'insert')
}

// ============================================================
// skips
// ============================================================
console.log('\n=== skips ===')
{
  const r = matchClienteToPatient(
    { documento: '1234567890', nombre: '', telefono: '3101111111' },
    existing,
  )
  assert('Skip por nombre vacío', r.type === 'skip_name_empty')
}
{
  const r = matchClienteToPatient(
    { documento: '   ', nombre: 'JUAN', telefono: '3101111111' },
    existing,
  )
  assert('Skip cédula con solo espacios → tras limpiar queda vacía',
    r.type === 'skip_cedula_invalid')
}
{
  const r = matchClienteToPatient(
    { documento: '123', nombre: 'JUAN', telefono: '3101111111' },
    existing,
  )
  assert('Skip cédula < 5 dígitos', r.type === 'skip_cedula_invalid')
}
{
  const r = matchClienteToPatient(
    { documento: '1234567890', nombre: 'JUAN', telefono: '0' },
    existing,
  )
  assert('Skip phone "0" (col TELÉFONO fijo)', r.type === 'skip_phone_invalid')
}
{
  const r = matchClienteToPatient(
    { documento: '1234567890', nombre: 'JUAN', telefono: '' },
    existing,
  )
  assert('Skip phone vacío', r.type === 'skip_phone_invalid')
}
{
  const r = matchClienteToPatient(
    { documento: '1234567890', nombre: 'JUAN', telefono: '6051234567' },  // fijo (no empieza con 3)
    existing,
  )
  assert('Skip phone fijo (no empieza con 3)', r.type === 'skip_phone_invalid')
}
{
  // Phone con 9 dígitos: no es celular válido
  const r = matchClienteToPatient(
    { documento: '1234567890', nombre: 'JUAN', telefono: '310111111' },
    existing,
  )
  assert('Skip phone con 9 dígitos', r.type === 'skip_phone_invalid')
}

// ============================================================
// Edge cases
// ============================================================
console.log('\n=== edge cases ===')
{
  // Mismo phone normalizado, distintas representaciones
  const r1 = matchClienteToPatient(
    { documento: '999', nombre: 'X', telefono: '+573101111111' },
    existing,
  )
  // documento "999" tiene 3 dígitos < 5 → skip_cedula_invalid antes de matchear phone
  assert('Cédula corta gana sobre match phone (skip primero)',
    r1.type === 'skip_cedula_invalid')
}
{
  // Documento con caracteres no-dígitos pre-cleaned
  // (el scraper ya limpia, pero por seguridad el matcher confía en lo que recibe)
  const r = matchClienteToPatient(
    { documento: '1234567890', nombre: 'JUAN', telefono: '573101111111' },  // sin "+"
    existing,
  )
  // normalizePhone: 12 digits start with 57 → +573101111111
  assert('Phone con 57 pero sin +', r.type === 'match_by_cedula')
}

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
if (failed > 0) process.exit(1)
