// scripts/test-res256-column-mapping.ts
import { mapSourceRowToRes256Row, normalizeDocumentTypeForPisis } from '../src/lib/reports/resolucion-256/column-mapping'
import type { Res256SourceRow } from '../src/lib/reports/resolucion-256/types'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

console.log('Tests Res-256 column-mapping\n')

// Caso happy path completo
{
  const source: Res256SourceRow = {
    appointment: {
      id: 'a1', starts_at: '2026-06-15T15:00:00Z',
      created_at: '2026-06-10T10:00:00Z',
      requested_at: '2026-06-10T10:00:00Z',
      desired_at: '2026-06-14',
      payment_type: 'EPS', eps_name: 'Nueva EPS',
      consultation_type_id: 'ct1', doctor_id: 'd1',
    },
    patient: {
      id: 'p1', document_type: 'CC', document_number: '0001090335249',
      date_of_birth: '1985-03-15', gender: 'F',
      first_name: 'Ana', middle_name: 'María',
      first_last_name: 'Franco', second_last_name: 'Muriel',
      eps: 'Nueva EPS', eapb_code: 'EPS037', name: 'Ana María Franco Muriel',
    },
    consultationType: { id: 'ct1', name: 'Consulta ginecología', res256_category: 'Ginecología' },
    doctor: { id: 'd1', name: 'Dra X', specialty: 'Ginecología' },
  }
  const row = mapSourceRowToRes256Row(source)
  assert('identificacion = CC', row.identificacion === 'CC')
  assert('numero sin ceros a la izquierda', row.numero === '1090335249')
  assert('fecha_nacimiento = 1985-03-15', row.fecha_nacimiento === '1985-03-15')
  assert('genero = F', row.genero === 'F')
  assert('primer_nombre = Ana', row.primer_nombre === 'Ana')
  assert('segundo_nombre = María', row.segundo_nombre === 'María')
  assert('primer_apellido = Franco', row.primer_apellido === 'Franco')
  assert('segundo_apellido = Muriel', row.segundo_apellido === 'Muriel')
  assert('codigo_eapb = EPS037', row.codigo_eapb === 'EPS037')
  assert('fecha_solicitud_cita = 2026-06-10', row.fecha_solicitud_cita === '2026-06-10')
  assert('fecha_asignacion (starts_at) = 2026-06-15 en COT', row.fecha_asignacion === '2026-06-15')
  assert('fecha_deseada = 2026-06-14', row.fecha_deseada === '2026-06-14')
}

// Particular: codigo_eapb = NA
{
  const source: Res256SourceRow = {
    appointment: {
      id: 'a2', starts_at: '2026-06-15T15:00:00Z',
      created_at: '2026-06-10T10:00:00Z', requested_at: null, desired_at: null,
      payment_type: 'Particular', eps_name: null,
      consultation_type_id: 'ct1', doctor_id: 'd1',
    },
    patient: {
      id: 'p1', document_type: 'CC', document_number: '12345',
      date_of_birth: '1990-01-01', gender: 'M',
      first_name: 'Juan', middle_name: null,
      first_last_name: 'Pérez', second_last_name: null,
      eps: null, eapb_code: null, name: 'Juan Pérez',
    },
    consultationType: { id: 'ct1', name: 'Ecografía', res256_category: 'Ecografía' },
    doctor: { id: 'd1', name: 'Dr Y', specialty: 'Radiologia' },
  }
  const row = mapSourceRowToRes256Row(source)
  assert('Particular → codigo_eapb = NA', row.codigo_eapb === 'NA')
  assert('segundo_nombre vacío permitido', row.segundo_nombre === '')
  assert('segundo_apellido vacío permitido', row.segundo_apellido === '')
}

// Paciente sin identificación: usar AS (adulto) o MS (menor)
{
  const source: Res256SourceRow = {
    appointment: {
      id: 'a3', starts_at: '2026-06-15T15:00:00Z', created_at: '2026-06-10T10:00:00Z',
      requested_at: null, desired_at: null,
      payment_type: 'Particular', eps_name: null,
      consultation_type_id: null, doctor_id: 'd1',
    },
    patient: {
      id: 'p1', document_type: 'AS', document_number: '',
      date_of_birth: '1985-03-15', gender: 'F',
      first_name: 'Sin', middle_name: null,
      first_last_name: 'Documento', second_last_name: null,
      eps: null, eapb_code: null, name: 'Sin Documento',
    },
    consultationType: null,
    doctor: { id: 'd1', name: 'Dra X', specialty: 'Ginecología' },
  }
  const row = mapSourceRowToRes256Row(source)
  assert('identificacion = AS sin documento', row.identificacion === 'AS')
  assert('numero = "" cuando es AS sin doc', row.numero === '')
}

// Sin patient → todos los campos demográficos vacíos
{
  const source: Res256SourceRow = {
    appointment: {
      id: 'a4', starts_at: '2026-06-15T15:00:00Z', created_at: '2026-06-10T10:00:00Z',
      requested_at: null, desired_at: null,
      payment_type: 'EPS', eps_name: 'Compensar',
      consultation_type_id: 'ct1', doctor_id: 'd1',
    },
    patient: null,
    consultationType: { id: 'ct1', name: 'Consulta', res256_category: 'Ginecología' },
    doctor: { id: 'd1', name: 'Dra X', specialty: 'Ginecología' },
  }
  const row = mapSourceRowToRes256Row(source)
  assert('Sin patient: identificacion = ""', row.identificacion === '')
  assert('Sin patient: numero = ""', row.numero === '')
  assert('Sin patient: usa eps_name del appointment → eapb_code = EPS023 (Compensar)', row.codigo_eapb === 'EPS023')
}

// normalizeDocumentTypeForPisis
assert('CC → CC', normalizeDocumentTypeForPisis('CC') === 'CC')
assert('TI → TI', normalizeDocumentTypeForPisis('TI') === 'TI')
assert('PP → PA', normalizeDocumentTypeForPisis('PP') === 'PA')  // Pasaporte: nuestro 'PP', PISIS 'PA'
assert('null → ""', normalizeDocumentTypeForPisis(null) === '')

console.log(`\n${passed} pasaron · ${failed} fallaron`)
if (failed > 0) process.exit(1)
