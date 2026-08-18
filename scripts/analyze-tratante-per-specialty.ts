/**
 * ⏳ DRY — ¿cuántos de los pacientes con tratante tienen consultas de MÁS de una
 * especialidad? (tratante por (paciente, especialidad) en vez de uno por paciente).
 * Regla: consulta Y médico ACTIVO; especialidad = la del doctor. NO escribe nada.
 * Run: npx tsx scripts/analyze-tratante-per-specialty.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function loadEnv(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv('.env.production.local'); loadEnv('.env.local')

import { createClient } from '@supabase/supabase-js'
import { canonize } from '../src/lib/isalud/name-matcher'
import { classifyServicio, type DerivRow } from '../src/lib/isalud/entidad-tratante-derivation'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: docsAll } = await supa.from('doctors').select('id, name, specialty, is_active').eq('clinic_id', ALGIA)
  const activeByCanon = new Map<string, { id: string; specialty: string | null }>()
  ;(docsAll ?? []).forEach((d) => { const x = d as { id: string; name: string; specialty: string | null; is_active: boolean }; if (x.is_active) activeByCanon.set(canonize(x.name), { id: x.id, specialty: x.specialty }) })

  // filas por documento
  const rowsByDoc = new Map<string, DerivRow[]>()
  let from = 0
  for (;;) {
    const { data } = await supa.from('isalud_historico_rows')
      .select('documento, profesional, servicio, procedimiento, fecha, inicio, isalud_agenda_id, aseguradora')
      .eq('clinic_id', ALGIA).range(from, from + 999)
    const rows = data ?? []
    for (const r of rows) {
      const x = r as DerivRow & { documento: string }
      if (!rowsByDoc.has(x.documento)) rowsByDoc.set(x.documento, [])
      rowsByDoc.get(x.documento)!.push(x)
    }
    if (rows.length < 1000) break
    from += 1000
  }
  // solo documentos de pacientes
  const patientDocs = new Set<string>()
  const { data: pd } = await supa.from('patients').select('document_number').eq('clinic_id', ALGIA).not('document_number', 'is', null)
  ;(pd ?? []).forEach((r) => patientDocs.add(String((r as { document_number: string }).document_number)))

  let conTratante = 0
  const bySpecCount = new Map<number, number>() // nº de especialidades → nº de pacientes
  let totalTratanteRows = 0
  for (const [documento, rows] of rowsByDoc) {
    if (!patientDocs.has(documento)) continue
    // especialidades distintas con al menos una consulta de médico activo
    const specs = new Set<string>()
    for (const r of rows) {
      if (classifyServicio(r.servicio, r.procedimiento) !== 'consulta') continue
      if (!r.profesional) continue
      const doc = activeByCanon.get(canonize(r.profesional))
      if (doc) specs.add(doc.specialty ?? '(sin especialidad)')
    }
    if (specs.size === 0) continue
    conTratante++
    totalTratanteRows += specs.size
    bySpecCount.set(specs.size, (bySpecCount.get(specs.size) ?? 0) + 1)
  }

  console.log('\n════ Tratante por (paciente, especialidad) — impacto ════')
  console.log(`  pacientes con tratante (≥1 especialidad): ${conTratante}`)
  console.log(`  → filas (paciente,especialidad) totales:  ${totalTratanteRows}`)
  console.log('  distribución (nº especialidades → nº pacientes):')
  ;[...bySpecCount.entries()].sort((a, b) => a[0] - b[0]).forEach(([n, count]) => {
    console.log(`    ${n} especialidad(es): ${count} paciente(s)`)
  })
  const multi = [...bySpecCount.entries()].filter(([n]) => n > 1).reduce((s, [, c]) => s + c, 0)
  console.log(`  → pacientes que se vuelven MULTI-tratante (>1 especialidad): ${multi}`)
}
main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1) })
