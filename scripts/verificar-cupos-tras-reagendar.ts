/**
 * Verifica el mensaje que recibe una paciente al tocar "Reagendar".
 * SOLO LECTURA: check_availability no escribe citas y no se envía nada.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-cupos-tras-reagendar.ts
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

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { proximosCuposLibres, mensajeConCupos } = await import('@/lib/calendar/proximos-cupos')
  const { nombreMedicoParaPaciente } = await import('@/lib/utils/normalize-name')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: docs } = await admin.from('doctors')
    .select('id, name, gender').eq('clinic_id', ALGIA).eq('is_active', true).limit(4)
  if (!docs?.length) throw new Error('Sin médicos — abortando')

  for (const d of docs) {
    const cupos = await proximosCuposLibres(ALGIA, d.id as string, 3)
    const msg = mensajeConCupos(cupos, nombreMedicoParaPaciente(d.name as string, d.gender as string | null))
    console.log(`\n══════ ${d.name} — ${cupos.length} cupos ══════`)
    console.log(msg)
  }
  console.log('\n(No se envió ningún mensaje.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
