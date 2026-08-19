/**
 * B5 — la tool de citas usa el patient_id resuelto, no el teléfono del modelo.
 * SOLO LECTURA: get_patient_appointments no escribe nada.
 *
 * Caso real: el 18/08 esta paciente preguntó "¿es a las 2 o a las 2:20?" —tenía
 * tres citas al día siguiente— y el agente le dijo "no tengo registrada una cita
 * tuya". Acá se comprueba contra la BASE, no contra el modelo.
 *
 * ⚠️ Imports dinámicos: los estáticos se hoistean por encima de loadEnvFile().
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-b5-patient-id-manda.ts
 */
if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}
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
const PACIENTE = 'bf1a535c-5ce1-4c1c-a734-7ce21e5d3695'
const TEL_REAL = '+573164781937'
const TEL_EQUIVOCADO = '+573000000000'   // lo que podría escribir mal el modelo

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { executeTool } = await import('@/agents/tools/executor')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctor } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true).limit(1).single()
  if (!clinic || !doctor) throw new Error('No pude cargar clínica o médico — abortando')

  // La VERDAD, leída directo de la base.
  const { data: reales } = await admin.from('appointments')
    .select('starts_at').eq('patient_id', PACIENTE)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .gte('starts_at', new Date().toISOString()).order('starts_at')
  const esperadas = reales?.length ?? 0
  console.log(`base: ${esperadas} citas futuras`)
  for (const a of reales ?? []) {
    console.log(`   · ${new Date(a.starts_at as string).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`)
  }

  const casos: [string, Record<string, unknown>, string | null][] = [
    ['patient_id resuelto + teléfono correcto', { patient_phone: TEL_REAL }, PACIENTE],
    ['patient_id resuelto + teléfono EQUIVOCADO', { patient_phone: TEL_EQUIVOCADO }, PACIENTE],
    ['patient_id resuelto + SIN teléfono', {}, PACIENTE],
    ['SIN patient_id, sólo teléfono (fallback viejo)', { patient_phone: TEL_REAL }, null],
    ['SIN patient_id + teléfono EQUIVOCADO (el bug)', { patient_phone: TEL_EQUIVOCADO }, null],
  ]

  let fallos = 0
  console.log('\n═══ La tool real, por cada camino ═══')
  for (const [label, input, pid] of casos) {
    const r = await executeTool('get_patient_appointments', input, ALGIA, clinic as never, doctor as never, null, pid)
    const total = ((r.data as { total?: number } | undefined)?.total) ?? 0
    // El último caso DEBE fallar: es exactamente el bug que documentamos.
    const debeEncontrar = pid !== null || input.patient_phone === TEL_REAL
    const ok = debeEncontrar ? total === esperadas : total === 0
    console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(46)} → ${total} citas`)
    if (!ok) fallos++
  }

  console.log(`\n${fallos === 0
    ? '✅ El patient_id manda: encuentra las citas aunque el teléfono venga mal.'
    : `❌ ${fallos} caso(s) no se comportaron como se esperaba`}`)
  process.exit(fallos === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
