import { validateRes256Row, REQUIRED_FIELDS } from '../src/lib/reports/resolucion-256/validate'
import type { Res256Row } from '../src/lib/reports/resolucion-256/types'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

const complete: Res256Row = {
  identificacion: 'CC', numero: '12345', fecha_nacimiento: '1990-01-01', genero: 'F',
  primer_nombre: 'Ana', segundo_nombre: '', primer_apellido: 'Pérez', segundo_apellido: '',
  codigo_eapb: 'EPS037', fecha_solicitud_cita: '2026-06-01',
  fecha_asignacion: '2026-06-15', fecha_deseada: '2026-06-15',
}

console.log('Tests Res-256 validate\n')

// Caso completo
{
  const r = validateRes256Row(complete)
  assert('Row completo válido', r.valid === true)
  assert('Sin campos faltantes', r.missingFields.length === 0)
}

// segundo_nombre y segundo_apellido vacíos NO bloquean (son opcionales)
{
  const r = validateRes256Row({ ...complete, segundo_nombre: '', segundo_apellido: '' })
  assert('segundo_nombre vacío OK', r.valid === true)
}

// Faltan campos obligatorios uno por uno
const obligatorios: (keyof Res256Row)[] = [
  'identificacion', 'numero', 'fecha_nacimiento', 'genero',
  'primer_nombre', 'primer_apellido', 'codigo_eapb',
  'fecha_solicitud_cita', 'fecha_asignacion', 'fecha_deseada',
]
for (const f of obligatorios) {
  const r = validateRes256Row({ ...complete, [f]: '' })
  assert(`Falta "${f}" → invalid`, r.valid === false && r.missingFields.includes(f))
}

// codigo_eapb = 'NA' es válido (particular)
{
  const r = validateRes256Row({ ...complete, codigo_eapb: 'NA' })
  assert('codigo_eapb = NA válido (particular)', r.valid === true)
}

// REQUIRED_FIELDS es exacto
assert('REQUIRED_FIELDS tiene 10 entries', REQUIRED_FIELDS.length === 10)
assert('REQUIRED_FIELDS no incluye segundo_nombre', !REQUIRED_FIELDS.includes('segundo_nombre' as keyof Res256Row))
assert('REQUIRED_FIELDS no incluye segundo_apellido', !REQUIRED_FIELDS.includes('segundo_apellido' as keyof Res256Row))

console.log(`\n${passed} pasaron · ${failed} fallaron`)
if (failed > 0) process.exit(1)
