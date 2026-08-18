/**
 * Smoke test post-deploy — verifica el fix de TZ contra la config REAL
 * de Algia en producción.
 *
 * NO simula la API de WhatsApp (eso lo hace Lady). En cambio:
 *   1. Trae working_hours real del Dr. Jorge Darío de prod Supabase
 *   2. Aplica la lógica idéntica a la deployada en check_availability
 *   3. Verifica que cada día de la próxima semana resuelve el dayKey
 *      correcto y la apertura esperada
 *
 * Run:
 *   TZ=UTC                npx tsx scripts/smoke-availability-prod.ts
 *   TZ=America/Bogota     npx tsx scripts/smoke-availability-prod.ts
 */

import { createClient } from '@supabase/supabase-js'
import { parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TIMEZONE = 'America/Bogota'

const ALGIA_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JORGE_ID = '069523a9-f13b-4268-a77c-514d54c5672c'

// Replica del helper en src/lib/utils/dates.ts
function getDayOfWeek(date: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return days[toZonedTime(date, TIMEZONE).getDay()]
}

let pass = 0
let fail = 0
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  console.log(`Server TZ: ${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone}\n`)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // 1. Traer working_hours real
  const { data: doc, error } = await admin
    .from('doctors')
    .select('name, working_hours')
    .eq('id', JORGE_ID)
    .eq('clinic_id', ALGIA_ID)
    .single()

  if (error || !doc) {
    console.error('No se pudo cargar el doctor:', error?.message)
    process.exit(1)
  }

  type DayCfg = { active: boolean; blocks: Array<{ start: string; end: string }> }
  const wh = doc.working_hours as Record<string, DayCfg>
  console.log(`Doctor: ${doc.name}`)
  console.log(`working_hours abierto en: ${Object.entries(wh).filter(([, v]) => v.active).map(([k]) => k).join(', ')}\n`)

  // 2. Próxima semana 2026-06-08 a 2026-06-14
  const fechas: Array<[string, string, boolean]> = [
    ['2026-06-08', 'monday',    true],
    ['2026-06-09', 'tuesday',   true],
    ['2026-06-10', 'wednesday', true],
    ['2026-06-11', 'thursday',  true],
    ['2026-06-12', 'friday',    true],
    ['2026-06-13', 'saturday',  true],
    ['2026-06-14', 'sunday',    false],
  ]

  // 3. Aplicar lógica del FIX deployado: parseISO con T12:00:00-05:00
  console.log('--- Fix deployado contra config real ---')
  for (const [dateStr, expectedKey, expectedOpen] of fechas) {
    const date = parseISO(`${dateStr}T12:00:00-05:00`)
    const dayKey = getDayOfWeek(date)
    const cfg = wh[dayKey]
    const isOpen = cfg.active && cfg.blocks.length > 0
    const horario = isOpen ? `${cfg.blocks[0].start}-${cfg.blocks[0].end}` : 'cerrado'

    assert(`${dateStr} → dayKey="${expectedKey}"`, dayKey === expectedKey, `got "${dayKey}"`)
    assert(`  ${dateStr} (${expectedKey}): abierto=${expectedOpen}, horario=${horario}`, isOpen === expectedOpen)
  }

  console.log(`\n${pass} pasaron · ${fail} fallaron`)

  // 4. Validación adicional: no hay citas futuras con fechas absurdas
  console.log('\n--- Sanidad histórica: citas WhatsApp en Algia últimos 7 días ---')
  const { data: apts } = await admin
    .from('appointments')
    .select('id, starts_at, doctor_id, status')
    .eq('clinic_id', ALGIA_ID)
    .eq('source', 'whatsapp_agent')
    .in('status', ['confirmed', 'rescheduled'])
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(10)
  console.log(`  Total: ${apts?.length ?? 0} citas creadas vía agente`)
  if (apts && apts.length > 0) {
    for (const apt of apts) {
      const cot = toZonedTime(new Date(apt.starts_at as string), TIMEZONE)
      const dayName = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][cot.getDay()]
      console.log(`    ${apt.id.slice(0, 8)} — ${dayName} ${apt.starts_at}`)
    }
  }

  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
