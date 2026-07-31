/**
 * ⏳ MIGRACIÓN ALGIA — sube el cache LOCAL de clientes iSalud a isalud_clientes.
 * Rescata los ~15K teléfonos que hoy viven solo en disco. NO toca iSalud.
 * Idempotente (upsert por clinic_id+documento). Reporte de cierre real.
 * Run: npx tsx scripts/load-isalud-clientes.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
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

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

interface Cliente { documento: string; nombre: string | null; telefono: string | null }

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const dir = join(homedir(), '.omuwan-cache', 'algia-clientes')
  if (!existsSync(dir)) { console.error(`[load] no existe el cache: ${dir}`); process.exit(1) }

  const batches = readdirSync(dir).filter((f) => f.startsWith('batch-') && f.endsWith('.json'))
  const byDoc = new Map<string, Cliente>()
  let totalObjs = 0, corruptos = 0
  for (const f of batches) {
    try {
      const arr = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Array<{ documento?: string; nombre?: string; telefono?: string }>
      for (const c of arr) {
        totalObjs++
        const doc = (c.documento ?? '').trim()
        if (!doc) continue
        byDoc.set(doc, { documento: doc, nombre: (c.nombre ?? '').trim() || null, telefono: (c.telefono ?? '').trim() || null })
      }
    } catch { corruptos++ }
  }
  console.log(`[load] batches=${batches.length} objetos=${totalObjs} corruptos=${corruptos} documentos distintos=${byDoc.size}`)

  const rows = [...byDoc.values()].map((c) => ({ clinic_id: ALGIA, ...c }))
  let upserted = 0, errors = 0
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supa.from('isalud_clientes').upsert(slice, { onConflict: 'clinic_id,documento' })
    if (error) { errors++; console.log(`  chunk ${i}-${i + slice.length} error: ${error.message}`) }
    else upserted += slice.length
    if ((i / CHUNK) % 5 === 0) console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`)
  }

  const { count } = await supa.from('isalud_clientes').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA)
  const { count: conTel } = await supa.from('isalud_clientes').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA).not('telefono', 'is', null)

  console.log('\n════════ REPORTE DE CIERRE — LOAD CLIENTES ════════')
  console.log(`  documentos distintos en cache:  ${byDoc.size}`)
  console.log(`  filas upserteadas:              ${upserted}`)
  console.log(`  chunks con error:               ${errors}`)
  console.log(`  → isalud_clientes total:        ${count}`)
  console.log(`  → con teléfono:                 ${conTel}`)
}
main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1) })
