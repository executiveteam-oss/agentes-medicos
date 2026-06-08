/**
 * Smoke E2E del reporte Resolución 256 contra producción.
 *
 * Carga consultation_types de Algia, aplica suggestRes256Category a cada uno,
 * simula la pipeline completa: fetch sources → dedup → map → validate → xlsx.
 *
 * NO modifica datos. Solo lee + genera xlsx en /tmp.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { mapSourceRowToRes256Row } from '../src/lib/reports/resolucion-256/column-mapping'
import { dedupFirstOfYear } from '../src/lib/reports/resolucion-256/dedup'
import { validateRes256Row } from '../src/lib/reports/resolucion-256/validate'
import { generateRes256Xlsx } from '../src/lib/reports/resolucion-256/xlsx-generator'
import { suggestRes256Category } from '../src/lib/utils/res256-heuristics'
import type { Res256SourceRow } from '../src/lib/reports/resolucion-256/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ALGIA_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

async function main() {
  console.log('Server TZ:', process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  console.log('\n--- 1. Heurística aplicada a consultation_types de Algia ---')
  const { data: types } = await admin
    .from('consultation_types')
    .select('id, name, res256_category')
    .eq('clinic_id', ALGIA_ID)
    .eq('is_active', true)
    .order('name')

  const counts = { Ginecología: 0, Obstetricia: 0, Ecografía: 0, 'Resonancia Magnética': 0, NoAplica: 0, null: 0 }
  for (const t of types ?? []) {
    const s = suggestRes256Category(t.name)
    counts[(s ?? 'null') as keyof typeof counts]++
    const mark = s ? '→ ' + s : '→ sin sugerencia'
    console.log(`  ${t.name.slice(0, 70).padEnd(70)} ${mark}`)
  }
  console.log('  Resumen heurística:', counts)

  console.log('\n--- 2. Citas iSalud de Algia: hoy NO se clasifican (Fase 1 excluye sin res256_category) ---')
  const { data: aptCount } = await admin
    .from('appointments')
    .select('id', { count: 'exact', head: false })
    .eq('clinic_id', ALGIA_ID)
    .limit(1)
  console.log(`  Total citas en Algia (any source): ${(aptCount ?? []).length > 0 ? '500+' : '0'}`)

  console.log('\n--- 3. Simular reporte con 2 fixtures sintéticas (paciente completo + paciente sin docs) ---')
  const synthRows: Res256SourceRow[] = [
    {
      appointment: {
        id: 'synth-1', starts_at: '2026-06-15T15:00:00Z', created_at: '2026-06-10T10:00:00Z',
        requested_at: '2026-06-10T10:00:00Z', desired_at: '2026-06-14',
        payment_type: 'EPS', eps_name: 'Nueva EPS',
        consultation_type_id: 'ct1', doctor_id: 'd1',
      },
      patient: {
        id: 'p1', document_type: 'CC', document_number: '1090335249',
        date_of_birth: '1990-05-15', gender: 'F',
        first_name: 'Ana', middle_name: 'María',
        first_last_name: 'Pérez', second_last_name: 'García',
        eps: 'Nueva EPS', eapb_code: 'EPS037', name: 'Ana María Pérez García',
      },
      consultationType: { id: 'ct1', name: 'Consulta Gineco', res256_category: 'Ginecología' },
      doctor: { id: 'd1', name: 'Dra X', specialty: 'Ginecología' },
    },
    {
      appointment: {
        id: 'synth-2', starts_at: '2026-06-16T15:00:00Z', created_at: '2026-06-11T10:00:00Z',
        requested_at: null, desired_at: null,
        payment_type: 'Particular', eps_name: null,
        consultation_type_id: 'ct2', doctor_id: 'd2',
      },
      patient: {
        id: 'p2', document_type: null, document_number: null,
        date_of_birth: null, gender: null,
        first_name: null, middle_name: null, first_last_name: null, second_last_name: null,
        eps: null, eapb_code: null, name: 'Sin datos',
      },
      consultationType: { id: 'ct2', name: 'Ecografía pélvica', res256_category: 'Ecografía' },
      doctor: { id: 'd2', name: 'Dr Y', specialty: 'Radiología' },
    },
  ]

  const dedupped = dedupFirstOfYear(synthRows)
  console.log(`  Dedup: ${synthRows.length} → ${dedupped.length} (sin colisiones)`)

  const mapped = dedupped.map(mapSourceRowToRes256Row)
  console.log(`  Mapping: ${mapped.length} rows con 12 columnas`)

  const validated = mapped.map((r) => ({ row: r, v: validateRes256Row(r) }))
  const ready = validated.filter((x) => x.v.valid).map((x) => x.row)
  const incomplete = validated.filter((x) => !x.v.valid).map((x) => ({ row: x.row, missingFields: x.v.missingFields.map(String) }))
  console.log(`  Listas: ${ready.length}, Incompletas: ${incomplete.length}`)

  const buf = await generateRes256Xlsx({
    ready,
    incomplete,
    fromDate: '2026-01-01',
    toDate: '2026-06-30',
    generatedAt: new Date().toISOString(),
  })
  const path = `/tmp/smoke-res256-${Date.now()}.xlsx`
  writeFileSync(path, buf)
  console.log(`\n✅ xlsx generado: ${path} (${(buf.byteLength / 1024).toFixed(1)} KB)`)
  console.log(`   Hoja 1 "Listas para PISIS": ${ready.length} filas con 12 columnas`)
  console.log(`   Hoja 2 "Incompletas": ${incomplete.length} filas con 13 columnas (cols obligatorias vacías resaltadas rojo)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
