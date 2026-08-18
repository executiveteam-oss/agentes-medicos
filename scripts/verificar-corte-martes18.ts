/**
 * Verificación en vivo del corte `clinica_no_operativa` — martes 18 ago 2026.
 *
 * Llama la MISMA tool que usa el agente (check_availability del executor real)
 * contra la config REAL de prod. NO envía WhatsApp y NO escribe en la DB:
 * check_availability es solo lectura.
 *
 * ⚠️ Los imports del app van DINÁMICOS a propósito: `@/lib/supabase/admin`
 * construye su cliente al evaluarse el módulo, y los imports estáticos se
 * hoistean por encima de loadEnvFile() — quedaba sin credenciales y devolvía
 * null en silencio, que se lee igual que "no hay filas".
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-corte-martes18.ts
 */
if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}
import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
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

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JUAN_DIEGO = '97a20f5e-4aac-48d0-bef9-4240e666dca5'

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { executeTool } = await import('@/agents/tools/executor')
  const { supabaseAdmin } = await import('@/lib/supabase/admin')

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: doctor } = await admin.from('doctors').select('*').eq('id', JUAN_DIEGO).single()
  if (!clinic || !doctor) throw new Error('No se pudo cargar clínica o médico')

  // Prueba de cordura: si supabaseAdmin no ve las filas, cualquier resultado
  // de abajo es basura y no evidencia de nada.
  const { data: probe, error: probeErr } = await supabaseAdmin
    .from('doctor_schedule_exceptions').select('exception_date, doctor_id')
  console.log('supabaseAdmin → excepciones:', JSON.stringify(probe), '| error:', probeErr?.message ?? 'ninguno')
  if (!probe) throw new Error('supabaseAdmin no está leyendo — abortando para no reportar un falso negativo')

  console.log('operational_status  :', JSON.stringify(clinic.operational_status))
  console.log('status_message      :', JSON.stringify(clinic.operational_status_message))
  console.log('médico              :', doctor.name, '| agenda_closed:', doctor.agenda_closed)

  for (const fecha of ['2026-08-18', '2026-08-19', '2026-08-17']) {
    console.log(`\n──── check_availability ${fecha} ────`)
    const res = await executeTool(
      'check_availability',
      { preferred_date: fecha, doctor_id: JUAN_DIEGO },
      ALGIA,
      clinic,
      doctor
    )
    console.log(JSON.stringify(res, null, 2))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
