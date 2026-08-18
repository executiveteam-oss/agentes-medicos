/**
 * Capas 1 y 2 contra la config REAL de prod, sin escribir citas.
 *
 * check_availability es solo lectura. Los create_appointment de acá se BLOQUEAN
 * antes del insert (por pin o por servicio), así que no crean nada: lo único
 * que dejan son filas de audit_log. Ningún escenario llega a insertar cita.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-pin-executor-prod.ts
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

const ALGIA   = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JORGE   = '069523a9-f13b-4268-a77c-514d54c5672c'
const JUANDI  = '97a20f5e-4aac-48d0-bef9-4240e666dca5'
const CT_JUANDI_CONTROL = 'cdb57967-5fc3-433e-b909-8dc6d20d382b'

let ok = 0, fail = 0
function check(label: string, cond: boolean, extra = '') {
  if (cond) { console.log(`  ✅ ${label}`); ok++ } else { console.log(`  ❌ ${label} ${extra}`); fail++ }
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { executeTool } = await import('@/agents/tools/executor')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: docs } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true).order('created_at')
  const porDefecto = docs!.find((d) => d.id !== JORGE)!   // el default NO es Jorge, a propósito
  const pinJorge = { doctor_id: JORGE, doctor_name: 'JORGE DARIO LOPEZ ISANOA' }

  console.log('CAPA 1 — el executor rechaza otro médico:\n')

  const r1 = await executeTool('check_availability',
    { preferred_date: '2026-08-19', doctor_id: JUANDI }, ALGIA, clinic as never, porDefecto as never, pinJorge) as { success: boolean; error?: string }
  check('check_availability con Juan Diego y pin=Jorge → BLOQUEADO',
    r1.success === false && (r1.error ?? '').startsWith('BLOCKED_BY_DOCTOR_PIN'), JSON.stringify(r1).slice(0, 160))

  const r2 = await executeTool('check_availability',
    { preferred_date: '2026-08-19', doctor_id: JORGE }, ALGIA, clinic as never, porDefecto as never, pinJorge) as { success: boolean; data?: Record<string, unknown> }
  check('check_availability con Jorge y pin=Jorge → PASA', r2.success === true, JSON.stringify(r2).slice(0, 160))
  console.log(`      (disponible=${(r2.data as {available?:boolean})?.available}, médico=${(r2.data as {doctor_name?:string})?.doctor_name ?? '—'})`)

  // Sin doctor_id el pin tiene que ganarle al default. No se puede leer
  // `doctor_name` (no viene cuando available=false), así que se compara contra
  // la corrida EXPLÍCITA con Jorge: si el pin se aplicó, son idénticas. Y se
  // contrasta con el default para que la prueba no pase por casualidad.
  const r3 = await executeTool('check_availability',
    { preferred_date: '2026-08-26' }, ALGIA, clinic as never, porDefecto as never, pinJorge)
  const rJorge = await executeTool('check_availability',
    { preferred_date: '2026-08-26', doctor_id: JORGE }, ALGIA, clinic as never, porDefecto as never, pinJorge)
  const rDefault = await executeTool('check_availability',
    { preferred_date: '2026-08-26', doctor_id: porDefecto.id }, ALGIA, clinic as never, porDefecto as never, null)
  check('sin doctor_id, el pin gana al default de la clínica',
    JSON.stringify(r3) === JSON.stringify(rJorge) && JSON.stringify(r3) !== JSON.stringify(rDefault),
    `\n      con pin  : ${JSON.stringify(r3).slice(0, 110)}\n      default  : ${JSON.stringify(rDefault).slice(0, 110)}`)

  const r4 = await executeTool('create_appointment',
    { doctor_id: JUANDI, starts_at: '2026-08-19T08:15:00-05:00', patient_name: 'PRUEBA INTERNA', patient_phone: '+570000000001', consultation_type_id: CT_JUANDI_CONTROL },
    ALGIA, clinic as never, porDefecto as never, pinJorge) as { success: boolean; error?: string }
  check('create_appointment con Juan Diego y pin=Jorge → BLOQUEADO antes del insert',
    r4.success === false && (r4.error ?? '').startsWith('BLOCKED_BY_DOCTOR_PIN'), JSON.stringify(r4).slice(0, 160))

  console.log('\nCAPA 2 — el servicio no existe bajo el médico pedido:\n')

  const r5 = await executeTool('create_appointment',
    { doctor_id: JORGE, starts_at: '2026-08-19T09:00:00-05:00', patient_name: 'PRUEBA INTERNA', patient_phone: '+570000000001',
      date_of_birth: '1990-05-10', document_type: 'CC', document_number: '99999999',
      consultation_type_id: CT_JUANDI_CONTROL },
    ALGIA, clinic as never, porDefecto as never, pinJorge) as { success: boolean; error?: string; data?: Record<string, unknown> }
  check('"control o seguimiento" (de Juan Diego) con Jorge → BLOCKED_BY_DOCTOR_PIN_SERVICE',
    r5.success === false && (r5.error ?? '').startsWith('BLOCKED_BY_DOCTOR_PIN_SERVICE'), JSON.stringify(r5).slice(0, 200))
  const lista = (r5.data as { servicios_disponibles_con_ese_medico?: string[] })?.servicios_disponibles_con_ese_medico ?? []
  check('le devuelve al modelo el catálogo REAL de Jorge', lista.length > 0, `lista=${lista.length}`)
  console.log('      servicios de Jorge que le pasa al modelo:')
  for (const l of lista) console.log(`        · ${l.split(' (tipo_id')[0]}`)

  console.log('\nSIN PIN — el flujo de siempre no cambia:\n')
  const r6 = await executeTool('check_availability',
    { preferred_date: '2026-08-19', doctor_id: JUANDI }, ALGIA, clinic as never, porDefecto as never, null) as { success: boolean }
  check('sin pin, check_availability con cualquier médico → PASA', r6.success === true)

  console.log(`\n═══ ${ok} ok · ${fail} fallan ═══`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
