#!/usr/bin/env node

// ============================================================
// MIGRATION: doctors.working_hours
//   Viejo: { monday: { start, end, active } }
//   Nuevo: { monday: { active, blocks: [{ start, end }] } }
//
// 100% ADITIVO: solo UPDATE de filas que están en formato viejo.
// Filas sin horario (NULL) se dejan tal cual.
// Filas ya en formato nuevo se omiten.
// ============================================================

const { createClient } = require('@supabase/supabase-js')
const { readFileSync } = require('fs')
const { resolve } = require('path')

const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i)] = t.slice(i + 1)
}

const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

function isOldFormatDay(d) {
  return d && typeof d === 'object' && (typeof d.start === 'string' || typeof d.end === 'string') && !Array.isArray(d.blocks)
}

function isNewFormatDay(d) {
  return d && typeof d === 'object' && Array.isArray(d.blocks)
}

function migrateDay(d) {
  if (!d) return { active: false, blocks: [] }
  if (isNewFormatDay(d)) {
    // Ya está nuevo, dejarlo (normalizando shape)
    return {
      active: d.active === true,
      blocks: (d.blocks || [])
        .filter((b) => b && typeof b.start === 'string' && typeof b.end === 'string')
        .map((b) => ({ start: b.start, end: b.end })),
    }
  }
  if (isOldFormatDay(d)) {
    if (typeof d.start === 'string' && typeof d.end === 'string') {
      return { active: d.active === true, blocks: [{ start: d.start, end: d.end }] }
    }
  }
  return { active: d.active === true, blocks: [] }
}

function migrateWorkingHours(wh) {
  const out = {}
  for (const k of DAYS) {
    out[k] = migrateDay(wh[k])
  }
  return out
}

function needsMigration(wh) {
  if (!wh) return false
  return DAYS.some((k) => isOldFormatDay(wh[k]))
}

async function main() {
  console.log('=== MIGRATION: doctors.working_hours ===\n')

  const { data: doctors, error } = await supa
    .from('doctors')
    .select('id, name, clinic_id, working_hours')

  if (error) { console.error('Read error:', error); process.exit(1) }

  console.log(`Total doctores: ${doctors.length}\n`)

  // Sample BEFORE
  console.log('=== SAMPLE ANTES ===')
  const sampleOld = doctors.find((d) => needsMigration(d.working_hours))
  if (sampleOld) {
    console.log(`${sampleOld.name} (${sampleOld.id}):`)
    console.log(JSON.stringify(sampleOld.working_hours, null, 2))
  } else {
    console.log('No hay filas en formato viejo (todas migradas o sin horario).')
  }
  console.log()

  // Categorize
  const toMigrate = doctors.filter((d) => needsMigration(d.working_hours))
  const alreadyNew = doctors.filter((d) => d.working_hours && !needsMigration(d.working_hours))
  const noHours = doctors.filter((d) => !d.working_hours)
  console.log(`A migrar: ${toMigrate.length}`)
  console.log(`Ya en formato nuevo: ${alreadyNew.length}`)
  console.log(`Sin horario (no se tocan): ${noHours.length}\n`)

  if (toMigrate.length === 0) {
    console.log('Nada que migrar.')
    return
  }

  // Apply
  let okCount = 0, errCount = 0
  for (const d of toMigrate) {
    const migrated = migrateWorkingHours(d.working_hours)
    const { error: updErr } = await supa
      .from('doctors')
      .update({ working_hours: migrated })
      .eq('id', d.id)
    if (updErr) {
      console.error(`  ✗ ${d.name}: ${updErr.message}`)
      errCount++
    } else {
      okCount++
    }
  }

  console.log(`\nMigrados OK: ${okCount}`)
  console.log(`Errores: ${errCount}`)

  // Sample AFTER
  if (sampleOld) {
    const { data: after } = await supa.from('doctors').select('working_hours').eq('id', sampleOld.id).single()
    console.log('\n=== SAMPLE DESPUÉS ===')
    console.log(`${sampleOld.name}:`)
    console.log(JSON.stringify(after.working_hours, null, 2))
  }

  // Final verification
  const { data: final } = await supa.from('doctors').select('id, working_hours')
  let finalOld = 0
  for (const d of final) {
    if (d.working_hours && needsMigration(d.working_hours)) finalOld++
  }
  console.log(`\nDoctores aún en formato viejo después de migrar: ${finalOld}`)
  console.log(finalOld === 0 ? '✅ Migración completa' : '⚠️  Quedan pendientes — revisar')
}

main().catch((e) => { console.error(e); process.exit(1) })
