/**
 * Busca un slot REAL disponible para Juan Diego en los próximos 7 días.
 * Lo usa el demo para que las conversaciones lleguen a create_appointment
 * sin trabarse en SLOT_JUST_TAKEN.
 *
 * Run: TZ=America/Bogota npx tsx scripts/find-real-slot-juan-diego.ts
 */

if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}

import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  const c = readFileSync(p, 'utf-8')
  for (const line of c.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')
loadEnvFile('.env.local')

import { createClient } from '@supabase/supabase-js'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const DOCTOR_JUAN_DIEGO_ID = '97a20f5e-4aac-48d0-bef9-4240e666dca5'
const PRIMERA_VEZ_CT_ID = 'df055e0b-cf1d-4a3b-a0e9-53aef6afece7'
const CONTROL_CT_ID = 'cdb57967-5fc3-433e-b909-8dc6d20d382b'

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
  const { data: doctorRow } = await supa.from('doctors').select('*').eq('id', DOCTOR_JUAN_DIEGO_ID).single()
  if (!clinicRow || !doctorRow) { console.error('FATAL'); process.exit(1) }

  const { executeTool } = await import('../src/agents/tools/executor')

  // Buscar slots para los próximos 7 días
  for (let i = 1; i <= 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const date = d.toISOString().slice(0, 10)
    const result = await executeTool(
      'check_availability',
      {
        doctor_id: DOCTOR_JUAN_DIEGO_ID,
        consultation_type_id: PRIMERA_VEZ_CT_ID,
        preferred_date: date,
      },
      ALGIA_CLINIC_ID,
      clinicRow,
      doctorRow,
    )
    if (result.success && result.data) {
      console.log(`Fecha: ${date} →`)
      console.log(JSON.stringify(result.data, null, 2).slice(0, 800))
      console.log('---')
      // Solo el primer día, para inspeccionar el shape
      if (i === 1) return
    }
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
