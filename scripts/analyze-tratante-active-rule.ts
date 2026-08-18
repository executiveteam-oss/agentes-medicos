/**
 * ⏳ DRY — impacto de la regla de dos condiciones para tratante:
 * una fila define tratante si es CONSULTA **Y** el profesional matchea un
 * médico ACTIVO de doctors. NO escribe nada. Solo cuenta el diff vs el estado
 * actual (que matcheaba contra CUALQUIER doctor, sin condición de consulta en
 * el match). Run: npx tsx scripts/analyze-tratante-active-rule.ts
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

function recencyKey(r: DerivRow): string {
  return `${r.fecha ?? '0000-00-00'} ${r.inicio ?? '00:00:00'} ${String(r.isalud_agenda_id).padStart(12, '0')}`
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: docsAll } = await supa.from('doctors').select('id, name, is_active').eq('clinic_id', ALGIA)
  const activeCanon = new Map<string, string>()
  ;(docsAll ?? []).forEach((d) => { const x = d as { id: string; name: string; is_active: boolean }; if (x.is_active) activeCanon.set(canonize(x.name), x.id) })
  console.log(`Doctores activos: ${activeCanon.size} de ${(docsAll ?? []).length}`)

  // patients: documento → tratante actual
  const { data: pats } = await supa.from('patients').select('document_number, tratante_doctor_id').eq('clinic_id', ALGIA).not('document_number', 'is', null)
  const currentTratante = new Map<string, string | null>()
  ;(pats ?? []).forEach((p) => { const x = p as { document_number: string; tratante_doctor_id: string | null }; currentTratante.set(String(x.document_number), x.tratante_doctor_id) })

  // filas por documento (paginado)
  const rowsByDoc = new Map<string, DerivRow[]>()
  let from = 0
  for (;;) {
    const { data } = await supa.from('isalud_historico_rows')
      .select('documento, aseguradora, profesional, servicio, procedimiento, fecha, inicio, isalud_agenda_id')
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

  let stayedSame = 0, changedDoctor = 0, droppedToNull = 0, gainedFromNull = 0
  for (const [documento, rows] of rowsByDoc) {
    const sorted = [...rows].sort((a, b) => (recencyKey(a) < recencyKey(b) ? 1 : recencyKey(a) > recencyKey(b) ? -1 : 0))
    let newId: string | null = null
    for (const r of sorted) {
      if (classifyServicio(r.servicio, r.procedimiento) === 'consulta' && r.profesional) {
        const id = activeCanon.get(canonize(r.profesional))
        if (id) { newId = id; break } // solo médico ACTIVO define tratante
      }
    }
    const cur = currentTratante.get(documento) ?? null
    if (cur && newId) { if (cur === newId) stayedSame++; else changedDoctor++ }
    else if (cur && !newId) droppedToNull++
    else if (!cur && newId) gainedFromNull++
  }

  console.log('\n════ Impacto regla "consulta Y médico ACTIVO" (dry) ════')
  console.log(`  Actualmente con tratante (363):`)
  console.log(`    - se mantienen igual:        ${stayedSame}`)
  console.log(`    - cambian de médico:         ${changedDoctor}`)
  console.log(`    - pasan a NULL (era inactivo/no-médico): ${droppedToNull}`)
  console.log(`  Actualmente NULL que GANAN tratante (caía en admin, hay consulta previa de médico activo): ${gainedFromNull}`)
  console.log(`  → cambian en total: ${changedDoctor + droppedToNull + gainedFromNull}`)
}
main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1) })
