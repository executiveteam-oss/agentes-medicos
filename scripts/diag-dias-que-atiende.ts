/**
 * ¿Qué devuelve check_availability cuando el día NO está activo?
 * ¿Incluye los días que SÍ atiende, o el modelo los inventa?
 * Solo lectura. Run: TZ=America/Bogota npx tsx scripts/diag-dias-que-atiende.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JORGE = '069523a9-f13b-4268-a77c-514d54c5672c'

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { executeTool } = await import('@/agents/tools/executor')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: docs } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true).order('created_at')
  const jorge = docs!.find((d) => d.id === JORGE)!

  // jue 20, sáb 22, dom 23 (los que dijo que SÍ atiende) + lun 24 (que sí atiende de verdad)
  for (const [fecha, dia] of [['2026-08-20','JUEVES'],['2026-08-22','SÁBADO'],['2026-08-23','DOMINGO'],['2026-08-24','LUNES']] as const) {
    const r = await executeTool('check_availability', { preferred_date: fecha, doctor_id: JORGE },
      ALGIA, clinic as never, jorge as never, { doctor_id: JORGE, doctor_name: jorge.name }) as { data?: Record<string, unknown> }
    const d = r.data ?? {}
    console.log(`\n─── ${dia} ${fecha} ───`)
    console.log(JSON.stringify(d, null, 2).slice(0, 420))
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
