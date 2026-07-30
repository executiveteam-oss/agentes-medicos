/**
 * Reproduce el bug: check_availability devolvía el horario del médico PRINCIPAL
 * (param `doctor`) para cualquier médico pedido. Fix: usa el horario del médico
 * PEDIDO (targetDoctor por doctor_id).
 *
 * Caso real Algia: Adriana NO atiende martes; Juan Diego SÍ (08:00–18:00).
 * Se llama check_availability para Adriana un MARTES, pasando a Juan Diego como
 * `doctor` param (el principal). Debe devolver available=false (Adriana no atiende
 * martes) — NO los cupos de Juan Diego. Antes del fix devolvía los de Juan Diego.
 * Read-only: check_availability no escribe.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-check-availability-doctor.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
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
loadEnvFile('.env.production.local'); loadEnvFile('.env.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const ADRIANA = '2b0e5172-97ae-43a2-a1be-b266880191a5'      // lunes INACTIVO
const JUAN_DIEGO = '97a20f5e-4aac-48d0-bef9-4240e666dca5'   // lunes 08:00–18:00 ACTIVO
const LUNES = '2026-08-03'                                  // un lunes futuro

async function main(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const { executeTool } = await import('../src/agents/tools/executor')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: clinic } = await supa.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: adriana } = await supa.from('doctors').select('*').eq('id', ADRIANA).single()

  // Llamada REAL que reproduce el bug reportado: doctor_id = Juan Diego (lunes ACTIVO),
  // pero el `doctor` param = Adriana (lunes INACTIVO), simulando que el principal es otro.
  // ANTES del fix: usaba Adriana (param) → available=false (el bug de "otra doctora").
  // DESPUÉS: usa Juan Diego (el pedido) → available=true, con SU horario.
  const result = await executeTool(
    'check_availability',
    { doctor_id: JUAN_DIEGO, preferred_date: LUNES },
    ALGIA,
    clinic as never,
    adriana as never,
  )
  const data = (result as { data?: { available?: boolean; reason?: string } }).data ?? {}

  console.log('Reproducción del bug check_availability (usa el médico PEDIDO, no el principal)\n')
  console.log(`  doctor_id = Juan Diego (lunes 08–18 ACTIVO) | doctor param = Adriana (lunes INACTIVO)`)
  console.log(`  → available=${data.available} reason="${data.reason ?? ''}"\n`)

  let ok = 0, fail = 0
  const a = (label: string, cond: boolean) => { cond ? (console.log(`  ✅ ${label}`), ok++) : (console.log(`  ❌ ${label}`), fail++) }

  a('usa el horario del médico PEDIDO (Juan Diego, lunes activo) → available=true', data.available === true)
  a('NO usa el horario del `doctor` param (Adriana, lunes inactivo)', data.reason !== 'El doctor no atiende ese día (lunes)')

  console.log(`\nResultado: ${ok} ✅ / ${fail} ❌`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
