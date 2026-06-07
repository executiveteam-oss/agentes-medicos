// scripts/test-res256-dedup.ts
import { dedupFirstOfYear } from '../src/lib/reports/resolucion-256/dedup'
import type { Res256SourceRow } from '../src/lib/reports/resolucion-256/types'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

function makeRow(opts: { patientId: string; startsAt: string; category: 'Ginecología' | 'Obstetricia' | 'Ecografía' | 'Resonancia Magnética' | 'NoAplica'; aptId?: string }): Res256SourceRow {
  return {
    appointment: {
      id: opts.aptId ?? 'a-' + Math.random(),
      starts_at: opts.startsAt,
      created_at: opts.startsAt, requested_at: null, desired_at: null,
      payment_type: 'EPS', eps_name: null,
      consultation_type_id: 'ct1', doctor_id: 'd1',
    },
    patient: { id: opts.patientId, document_type: null, document_number: null, date_of_birth: null, gender: null, first_name: null, middle_name: null, first_last_name: null, second_last_name: null, eps: null, eapb_code: null, name: 'X' },
    consultationType: { id: 'ct1', name: 'X', res256_category: opts.category },
    doctor: { id: 'd1', name: 'X', specialty: 'X' },
  }
}

console.log('Tests Res-256 dedup\n')

// Gineco: paciente con 3 citas en 2026 → solo la primera del año
{
  const rows = [
    makeRow({ patientId: 'P1', startsAt: '2026-03-15T10:00:00Z', category: 'Ginecología', aptId: 'a-mar' }),
    makeRow({ patientId: 'P1', startsAt: '2026-01-10T10:00:00Z', category: 'Ginecología', aptId: 'a-ene' }),
    makeRow({ patientId: 'P1', startsAt: '2026-05-20T10:00:00Z', category: 'Ginecología', aptId: 'a-may' }),
  ]
  const out = dedupFirstOfYear(rows)
  assert('Gineco: queda solo 1 cita (la primera del año)', out.length === 1)
  assert('Gineco: la cita que queda es la de enero', out[0].appointment.id === 'a-ene')
}

// Obstetricia: misma regla (primera del año)
{
  const rows = [
    makeRow({ patientId: 'P1', startsAt: '2026-03-15T10:00:00Z', category: 'Obstetricia', aptId: 'a1' }),
    makeRow({ patientId: 'P1', startsAt: '2026-01-10T10:00:00Z', category: 'Obstetricia', aptId: 'a2' }),
  ]
  const out = dedupFirstOfYear(rows)
  assert('Obstetricia: dedup activo', out.length === 1)
  assert('Obstetricia: primera del año', out[0].appointment.id === 'a2')
}

// Ecografía: NO dedup, todas pasan
{
  const rows = [
    makeRow({ patientId: 'P1', startsAt: '2026-03-15T10:00:00Z', category: 'Ecografía', aptId: 'a1' }),
    makeRow({ patientId: 'P1', startsAt: '2026-01-10T10:00:00Z', category: 'Ecografía', aptId: 'a2' }),
    makeRow({ patientId: 'P1', startsAt: '2026-05-20T10:00:00Z', category: 'Ecografía', aptId: 'a3' }),
  ]
  const out = dedupFirstOfYear(rows)
  assert('Ecografía: TODAS pasan', out.length === 3)
}

// RMN: NO dedup
{
  const rows = [
    makeRow({ patientId: 'P1', startsAt: '2026-03-15T10:00:00Z', category: 'Resonancia Magnética', aptId: 'a1' }),
    makeRow({ patientId: 'P1', startsAt: '2026-05-20T10:00:00Z', category: 'Resonancia Magnética', aptId: 'a2' }),
  ]
  const out = dedupFirstOfYear(rows)
  assert('RMN: TODAS pasan', out.length === 2)
}

// Dos pacientes distintos en Gineco: ambos cuentan su propia primera
{
  const rows = [
    makeRow({ patientId: 'P1', startsAt: '2026-03-15T10:00:00Z', category: 'Ginecología', aptId: 'P1-mar' }),
    makeRow({ patientId: 'P2', startsAt: '2026-04-10T10:00:00Z', category: 'Ginecología', aptId: 'P2-abr' }),
  ]
  const out = dedupFirstOfYear(rows)
  assert('Dos pacientes: ambas citas pasan', out.length === 2)
}

// Año distinto: 1 cita de 2025, 1 de 2026 — ambas pasan (primera de cada año)
{
  const rows = [
    makeRow({ patientId: 'P1', startsAt: '2025-11-15T10:00:00Z', category: 'Ginecología', aptId: 'a2025' }),
    makeRow({ patientId: 'P1', startsAt: '2026-01-10T10:00:00Z', category: 'Ginecología', aptId: 'a2026' }),
  ]
  const out = dedupFirstOfYear(rows)
  assert('Una por año pasa', out.length === 2)
}

// Mismo paciente Gineco y Ecografía: dedup separado por categoría
{
  const rows = [
    makeRow({ patientId: 'P1', startsAt: '2026-01-10T10:00:00Z', category: 'Ginecología', aptId: 'gin-ene' }),
    makeRow({ patientId: 'P1', startsAt: '2026-03-10T10:00:00Z', category: 'Ginecología', aptId: 'gin-mar' }),  // dedup
    makeRow({ patientId: 'P1', startsAt: '2026-02-10T10:00:00Z', category: 'Ecografía', aptId: 'eco-feb' }),
    makeRow({ patientId: 'P1', startsAt: '2026-04-10T10:00:00Z', category: 'Ecografía', aptId: 'eco-abr' }),
  ]
  const out = dedupFirstOfYear(rows)
  assert('Gineco dedup + Eco no-dedup → 3 rows total', out.length === 3)
  assert('Gineco de enero está', out.some(r => r.appointment.id === 'gin-ene'))
  assert('Gineco de marzo NO está', !out.some(r => r.appointment.id === 'gin-mar'))
  assert('Ambas Eco están', out.some(r => r.appointment.id === 'eco-feb') && out.some(r => r.appointment.id === 'eco-abr'))
}

console.log(`\n${passed} pasaron · ${failed} fallaron`)
if (failed > 0) process.exit(1)
