/**
 * Verifica que CADA consulta de disponibilidad deje registro, en los tres
 * desenlaces que hay que poder distinguir.
 *
 * check_availability es SOLO LECTURA: no crea citas ni envía nada. Lo único que
 * escribe es la fila de audit_log que estamos probando.
 *
 * ⚠️ Imports dinámicos: los estáticos se hoistean por encima de loadEnvFile().
 *
 * Run: TZ=America/Bogota npx tsx scripts/verificar-instrumentacion-disponibilidad.ts
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
  const { executeTool } = await import('@/agents/tools/executor')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: clinic } = await admin.from('clinics').select('*').eq('id', ALGIA).single()
  const { data: docs } = await admin.from('doctors').select('*').eq('clinic_id', ALGIA).eq('is_active', true)
  if (!clinic || !docs?.length) throw new Error('No pude cargar clínica o médicos — abortando')
  const doctor = docs[0]

  const desde = new Date().toISOString()
  const casos: [string, Record<string, unknown>][] = [
    ['un día que atiende (esperamos cupos)', { preferred_date: '2026-08-26', doctor_id: doctor.id }],
    ['un domingo (no atiende)', { preferred_date: '2026-08-23', doctor_id: doctor.id }],
    ['una fecha inválida', { preferred_date: 'no-es-una-fecha', doctor_id: doctor.id }],
  ]

  for (const [label, input] of casos) {
    const r = await executeTool('check_availability', input, ALGIA, clinic as never, doctor as never)
    const d = (r.data ?? {}) as { total_available?: number; reason?: string }
    console.log(`  ${label.padEnd(38)} success=${r.success} cupos=${d.total_available ?? 0}`)
  }

  // Lo que importa: ¿quedó registro de las TRES?
  const { data: filas } = await admin.from('audit_log')
    .select('details, created_at')
    .eq('clinic_id', ALGIA).eq('action', 'disponibilidad_consultada')
    .gte('created_at', desde).order('created_at')

  console.log(`\n═══ Filas registradas: ${filas?.length ?? 0} de ${casos.length} ═══`)
  for (const f of filas ?? []) {
    const d = f.details as Record<string, unknown>
    console.log(`  cupos=${d.cupos_devueltos} hubo_cupos=${d.hubo_cupos} exito=${d.exito}`)
    console.log(`     médico: ${d.medico ?? '—'} · pedida: ${d.fecha_pedida} · resuelta: ${d.fecha_resuelta ?? '—'}`)
    console.log(`     motivo sin cupo: ${d.motivo_sin_cupo ?? '(había cupos)'}`)
  }
  const ok = (filas?.length ?? 0) === casos.length
  console.log(`\n${ok ? '✅ las tres quedaron registradas' : '❌ falta registro de alguna'}`)
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
