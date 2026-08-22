/**
 * EL NÚMERO SEMANAL: ¿cuántas conversaciones atendió el agente porque nadie
 * del equipo las abrió?
 *
 * Sale de `audit_log.action = 'agente_cubrio_escalada_sin_humano'`, que estampa
 * el webhook cada vez que el corte por escalada se destraba (route.ts, paso 15).
 *
 * Este contador NO es decorativo. El destrabe del corte le saca a la clínica el
 * síntoma —la paciente ya no queda en silencio— sin sacarle la causa: sigue
 * habiendo conversaciones que nadie abrió. Sin este número el arreglo esconde
 * el problema en vez de mostrarlo, y en un mes nadie sabría que existe.
 *
 * Run: TZ=America/Bogota npx tsx scripts/cobertura-escaladas-sin-humano.mts [semanas]
 */
import { existsSync, readFileSync } from 'fs'
function le(p: string) { if (!existsSync(p)) return; for (const l of readFileSync(p, 'utf-8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#')) continue; const e = t.indexOf('='); if (e < 0) continue; const k = t.slice(0, e).trim(); let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!process.env[k]) process.env[k] = v } }
le('.env.production.local'); le('.env.local')

const { supabaseAdmin } = await import('@/lib/supabase/admin')
const { ESCALATION_LABEL, isKnownReason } = await import('@/lib/conversations/escalation-reasons')

const semanas = Number(process.argv[2] ?? 4)
const desde = new Date(Date.now() - semanas * 7 * 864e5).toISOString()

const { data, error } = await supabaseAdmin
  .from('audit_log')
  .select('clinic_id, target_id, details, created_at')
  .eq('action', 'agente_cubrio_escalada_sin_humano')
  .gte('created_at', desde)
  .order('created_at', { ascending: true })
  .limit(5000)

if (error) { console.error('query falló:', error.message); process.exit(1) }

const filas = (data ?? []) as Array<{ clinic_id: string; target_id: string; details: Record<string, unknown> | null; created_at: string }>
if (filas.length === 0) {
  console.log(`\nSin registros en las últimas ${semanas} semanas.`)
  console.log('Ojo: cero puede ser "nadie dejó a una paciente esperando" o "el cambio todavía no está en producción". No son lo mismo.\n')
  process.exit(0)
}

const semanaDe = (iso: string) => {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))   // lunes de esa semana
  return d.toISOString().slice(0, 10)
}

const porSemana = new Map<string, { turnos: number; convs: Set<string>; motivos: Map<string, number>; horas: number[] }>()
for (const f of filas) {
  const k = semanaDe(f.created_at)
  const g = porSemana.get(k) ?? { turnos: 0, convs: new Set<string>(), motivos: new Map<string, number>(), horas: [] }
  g.turnos++
  g.convs.add(f.target_id)
  const motivo = String(f.details?.motivo_escalacion ?? '(n/d)')
  g.motivos.set(motivo, (g.motivos.get(motivo) ?? 0) + 1)
  const h = f.details?.horas_sin_humano
  if (typeof h === 'number') g.horas.push(h)
  porSemana.set(k, g)
}

console.log(`\n═══ COBERTURA DEL AGENTE SOBRE ESCALADAS SIN HUMANO — últimas ${semanas} semanas ═══\n`)
console.log('semana (lunes)   conversaciones   turnos   espera máx   motivo más frecuente')
console.log('─'.repeat(88))
for (const [k, g] of [...porSemana].sort()) {
  const top = [...g.motivos].sort((a, b) => b[1] - a[1])[0]
  const etiqueta = isKnownReason(top[0]) ? ESCALATION_LABEL[top[0]] : top[0]
  const maxh = g.horas.length ? Math.max(...g.horas) : 0
  console.log(`${k}       ${String(g.convs.size).padStart(14)}   ${String(g.turnos).padStart(6)}   ${String(maxh + ' h').padStart(10)}   ${etiqueta} (${top[1]})`)
}
console.log('─'.repeat(88))
const convs = new Set(filas.map((f) => f.target_id))
console.log(`\nEn total: ${convs.size} conversaciones las atendió el agente porque nadie del equipo las abrió (${filas.length} turnos).\n`)
