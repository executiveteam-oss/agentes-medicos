/**
 * ¿El LECTOR y el ESCRITOR contestan lo mismo?
 *
 * check_availability ofrece horas; puedeEscribirseLaCita decide si se pueden
 * escribir. Si difieren, el agente ofrece un cupo que el executor después
 * rechaza — y la paciente se queda sin cita por un desacuerdo interno nuestro.
 *
 * Se prueba sobre los días con EXCEPCIÓN de horario cargada, que es donde
 * estaban divergiendo: el lector las mira, el escritor no.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-lector-vs-escritor.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function le(p: string): void {
  if (!existsSync(p)) return
  for (const l of readFileSync(p, 'utf-8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const e = t.indexOf('='); if (e < 0) continue
    const k = t.slice(0, e).trim(); let v = t.slice(e + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
le('.env.production.local'); le('.env.local')
import { createClient } from '@supabase/supabase-js'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { executeTool } = await import('../src/agents/tools/executor')
  const { puedeEscribirseLaCita } = await import('../src/lib/calendar/appointment-write-check')
  const { data: clinic } = await supa.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: excepciones } = await supa
    .from('doctor_schedule_exceptions')
    .select('doctor_id, exception_date, blocks')
    .eq('clinic_id', ALGIA).order('exception_date')

  console.log(`\nExcepciones de horario cargadas: ${excepciones?.length ?? 0}\n`)
  let divergen = 0
  for (const exc of excepciones ?? []) {
    const { data: doc } = await supa.from('doctors').select('*').eq('id', exc.doctor_id).single()
    const r = await executeTool('check_availability',
      { preferred_date: exc.exception_date, doctor_id: exc.doctor_id }, ALGIA, clinic as never, doc as never)
    const d = (r.data ?? {}) as { available?: boolean; slots?: { time: string; starts_at: string }[]; reason?: string }
    const slots = d.slots ?? []
    console.log(`${exc.exception_date} · ${doc!.name}`)
    console.log(`   excepción: ${(exc.blocks as Array<{start:string;end:string}>).map((b) => `${b.start}–${b.end}`).join(', ')}`)
    console.log(`   LECTOR   → ${slots.length} cupos ${slots.slice(0, 3).map((s) => s.time).join(' ')}${d.reason ? ` (${d.reason.slice(0, 60)})` : ''}`)
    if (slots.length === 0) { console.log('   (sin cupos que contrastar)\n'); continue }
    let malos = 0
    for (const s of slots) {
      const w = await puedeEscribirseLaCita({
        clinic: clinic as Parameters<typeof puedeEscribirseLaCita>[0]['clinic'],
        doctorId: exc.doctor_id, startsAt: s.starts_at, now: new Date(),
      })
      if (!w.ok && w.outcome === 'out_of_schedule') malos++
    }
    console.log(`   ESCRITOR → ${slots.length - malos}/${slots.length} escribibles${malos ? `  🔴 ${malos} rechazados` : '  ✅'}\n`)
    if (malos) divergen++
  }
  console.log(divergen === 0
    ? '── Lector y escritor coinciden en todos los días con excepción ──\n'
    : `── 🔴 DIVERGEN en ${divergen} día(s) ──\n`)
}
main().catch((e) => { console.error(e); process.exit(1) })
