/**
 * ¿Qué reagendamientos habrían quedado BLOQUEADOS con la validación completa
 * (agenda cerrada + fecha bloqueada + franja del médico) puesta en reschedule?
 *
 * Corre las funciones REALES contra datos REALES de producción. No inventa
 * la lógica en SQL: importa las mismas que usa el executor, que es la única
 * forma de que el número mida lo que se va a deployar.
 *
 * Run: TZ=America/Bogota npx tsx scripts/medir-reschedules-vs-validacion.ts [dias]
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
import { format, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { getDoctorDaySchedule, dayKeyFromIndex, isRangeWithinSchedule } from '../src/lib/calendar/schedule-check'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const TZ = 'America/Bogota'

async function main(): Promise<void> {
  const dias = parseInt(process.argv[2] ?? '10', 10)
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const desde = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString()

  // Los reagendamientos del período, desde audit_log (la fuente de verdad de
  // "esto lo movió el agente"), no desde appointments.source.
  const { data: eventos } = await supa
    .from('audit_log')
    .select('created_at, target_id, details')
    .eq('clinic_id', ALGIA)
    .eq('action', 'appointment_rescheduled')
    .gte('created_at', desde)
    .order('created_at')

  console.log(`\nReagendamientos del agente en los últimos ${dias} días: ${eventos?.length ?? 0}\n`)
  if (!eventos?.length) { console.log('(nada que medir)'); return }

  const { data: docs } = await supa.from('doctors').select('id, name, working_hours, agenda_closed').eq('clinic_id', ALGIA)
  const { data: bloqueos } = await supa.from('blocked_dates').select('doctor_id, start_date, end_date, reason, created_at').eq('clinic_id', ALGIA)
  const porId = new Map((docs ?? []).map((d) => [d.id, d]))

  // ⚠️ El horario de HOY no es el que había cuando se escribió la cita.
  // Medir con el actual da un número inflado: el 17/08 los lunes de un médico
  // se desactivaron 21 minutos DESPUÉS del reagendamiento, y con el horario de
  // hoy esa cita aparece "bloqueada" cuando en su momento era perfectamente
  // válida. Se reconstruye el working_hours vigente en el instante del write
  // desde audit_log.
  const { data: cambios } = await supa
    .from('audit_log')
    .select('created_at, target_id, details')
    .eq('clinic_id', ALGIA)
    .eq('action', 'doctor_working_hours_updated')
    .order('created_at')

  function horarioVigente(doctorId: string, cuando: string): unknown | null {
    const previos = (cambios ?? []).filter((c) => c.target_id === doctorId && c.created_at <= cuando)
    if (previos.length === 0) return porId.get(doctorId)?.working_hours ?? null
    const ultimo = previos[previos.length - 1]
    return (ultimo.details as Record<string, unknown>)?.working_hours ?? null
  }

  let bloqueados = 0
  for (const ev of eventos) {
    const { data: cita } = await supa
      .from('appointments')
      .select('id, doctor_id, starts_at, ends_at, status')
      .eq('id', ev.target_id as string)
      .maybeSingle()
    if (!cita) { console.log(`  ⚠️  cita ${ev.target_id} no encontrada`); continue }

    const doc = porId.get(cita.doctor_id!)
    const sZ = toZonedTime(parseISO(cita.starts_at), TZ)
    const eZ = toZonedTime(parseISO(cita.ends_at), TZ)
    const dateStr = format(sZ, 'yyyy-MM-dd')
    const dayKey = dayKeyFromIndex(sZ.getDay())
    const whVigente = horarioVigente(cita.doctor_id!, ev.created_at as string)
    const sched = getDoctorDaySchedule(whVigente, dayKey)

    const motivos: string[] = []
    if (doc?.agenda_closed) motivos.push('agenda_closed')
    // El bloqueo de fecha también cuenta solo si YA existía cuando se escribió.
    if ((bloqueos ?? []).some((b) => (!b.doctor_id || b.doctor_id === cita.doctor_id)
        && b.start_date <= dateStr && b.end_date >= dateStr
        && (b.created_at as string) <= (ev.created_at as string))) motivos.push('blocked_date')
    if (!isRangeWithinSchedule(format(sZ, 'HH:mm'), format(eZ, 'HH:mm'), sched)) motivos.push('out_of_schedule')

    const franjas = sched.active ? sched.blocks.map((b) => `${b.start}-${b.end}`).join(', ') : 'día inactivo'
    const marca = motivos.length ? '🔴 BLOQUEADA' : '✅ pasa'
    if (motivos.length) bloqueados++
    console.log(`${marca}  cita ${format(sZ, 'dd/MM')} ${format(sZ, 'HH:mm')}-${format(eZ, 'HH:mm')} · ${doc?.name ?? '?'} · ${dayKey}  (movida el ${String(ev.created_at).slice(0, 16).replace('T', ' ')})`)
    console.log(`         franjas: ${franjas}${motivos.length ? `  → ${motivos.join(', ')}` : ''}`)
  }
  console.log(`\n── ${bloqueados} de ${eventos.length} habrían quedado bloqueados ──\n`)
}
main().catch((e) => { console.error(e); process.exit(1) })
