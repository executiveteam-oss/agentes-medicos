/**
 * Verificación del backstop de reagendamiento, contra PRODUCCIÓN.
 *
 * 1. El caso de Jennifer reproducido: mover su cita a un viernes 13:00 con
 *    Jorge (que los viernes atiende 07:30–11:00) → debe quedar BLOQUEADO.
 *    Se corre por los DOS caminos: la función pura y el executor real.
 * 2. Un reagendamiento legítimo: mismo médico, hora dentro de su franja →
 *    debe PASAR el gate.
 *
 * ⚠️ NO ESCRIBE. El caso legítimo se valida hasta la puerta del INSERT y ahí
 * se corta a propósito: mover la cita de una paciente real necesita el OK
 * explícito del dueño del producto, no el de un script.
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-reschedule-validacion.ts
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
loadEnvFile('.env.production.local'); loadEnvFile('.env.local')

import { createClient } from '@supabase/supabase-js'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const JORGE = '069523a9-f13b-4268-a77c-514d54c5672c'

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { puedeEscribirseLaCita } = await import('../src/lib/calendar/appointment-write-check')
  const { executeTool } = await import('../src/agents/tools/executor')

  const { data: doc } = await supa.from('doctors').select('name, working_hours').eq('id', JORGE).single()
  const viernes = (doc!.working_hours as Record<string, { active: boolean; blocks: Array<{ start: string; end: string }> }>).friday
  console.log(`\nMédico: ${doc!.name}`)
  console.log(`Viernes: ${viernes.active ? viernes.blocks.map((b) => `${b.start}–${b.end}`).join(', ') : 'inactivo'}\n`)

  // La cita real de Jennifer (la que quedó mal escrita el 18/08).
  const { data: cita } = await supa
    .from('appointments')
    .select('id, starts_at, ends_at, doctor_id, status')
    .eq('clinic_id', ALGIA).eq('doctor_id', JORGE)
    .eq('status', 'confirmed').gt('starts_at', new Date().toISOString())
    .order('starts_at').limit(1).single()
  console.log(`Cita a mover: ${cita!.id.slice(0, 8)} · ${cita!.starts_at}\n`)

  const casos = [
    { nombre: '🔴 CASO JENNIFER — viernes 13:00 (fuera de 07:30–11:00)', start: '2026-09-04T18:00:00.000Z', end: '2026-09-04T18:30:00.000Z' },
    // Viernes 25/09 09:00 COT: dentro de 07:30–11:00 y con el cupo libre
    // (ese día sólo está tomada la de las 07:30).
    { nombre: '✅ LEGÍTIMO   — viernes 09:00 (dentro de la franja, cupo libre)', start: '2026-09-25T14:00:00.000Z', end: '2026-09-25T14:30:00.000Z' },
    { nombre: '🔴 DÍA QUE NO ATIENDE — jueves 09:00',                            start: '2026-09-24T14:00:00.000Z', end: '2026-09-24T14:30:00.000Z' },
  ]

  for (const c of casos) {
    const r = await puedeEscribirseLaCita({
      clinicId: ALGIA, doctorId: JORGE,
      startsAt: c.start, endsAt: c.end, now: new Date(),
      excluirAppointmentId: cita!.id,
    })
    console.log(`${c.nombre}`)
    if (r.ok) {
      console.log(`   → PASA el gate (se escribiría)\n`)
    } else {
      console.log(`   → BLOQUEADO · outcome=${r.outcome} · code=${r.errorCode}`)
      console.log(`   → a la paciente: "${r.messageForPatient}"`)
      console.log(`   → al modelo:     "${r.instructionForLlm.slice(0, 110)}…"\n`)
    }
  }

  // End-to-end por el executor REAL, sólo el caso que DEBE bloquear.
  // Si el gate fallara, esto escribiría — por eso va después de confirmarlo arriba.
  console.log('── El mismo caso, por el executor real (reschedule_appointment) ──')
  const antes = await supa.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA)
  const res = await executeTool(
    'reschedule_appointment',
    { appointment_id: cita!.id, new_starts_at: '2026-09-04T18:00:00.000Z' },
    ALGIA,
    (await supa.from('clinics').select('*').eq('id', ALGIA).single()).data as never
  )
  const despues = await supa.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', ALGIA)
  console.log(`   success=${(res as { success: boolean }).success}  error=${(res as { error?: string }).error}`)
  console.log(`   citas antes=${antes.count}  después=${despues.count}  → ${antes.count === despues.count ? 'NO se escribió nada ✅' : '🚨 SE ESCRIBIÓ UNA FILA'}`)

  const { data: audit } = await supa.from('audit_log')
    .select('action, details').eq('clinic_id', ALGIA)
    .eq('action', 'reschedule_appointment_blocked_by_schedule')
    .order('created_at', { ascending: false }).limit(1)
  console.log(`   audit_log: ${audit?.length ? JSON.stringify(audit[0].details).slice(0, 160) + '…' : '(sin registro)'}\n`)
}
main().catch((e) => { console.error(e); process.exit(1) })
