/** Medición del rescate: delivered/read/respuestas por tanda, desde audit_log + status. */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
const { createClient } = await import('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'

const { data: envios } = await db.from('audit_log')
  .select('target_id, details, created_at').eq('clinic_id', ALGIA)
  .eq('action','canal_reabierto_migracion').order('created_at')
type E = { target_id: string; details: Record<string, unknown>; created_at: string }
const lista = (envios ?? []) as E[]
if (lista.length === 0) { console.log('sin envíos registrados'); process.exit(0) }
const wamids = lista.map((e) => e.details.wamid as string).filter(Boolean)

const { data: st } = await db.from('whatsapp_message_status').select('wamid, status, error_code').in('wamid', wamids)
const estado = new Map((st ?? []).map((s) => [s.wamid as string, s]))

const ids = lista.map((e) => e.target_id)
const { data: convs } = await db.from('conversations').select('id, patient_id, status, triage_state').in('patient_id', ids)
const convDe = new Map((convs ?? []).map((c) => [c.patient_id as string, c]))
const desde = lista[0].created_at
const { data: msgs } = await db.from('messages').select('conversation_id, created_at')
  .in('conversation_id', (convs ?? []).map((c) => c.id as string)).eq('role','patient').gte('created_at', desde)
const respondio = new Set((msgs ?? []).map((m) => {
  const c = (convs ?? []).find((x) => x.id === m.conversation_id); return c?.patient_id as string
}).filter(Boolean))

const { data: pac } = await db.from('patients').select('id, name').in('id', ids)
const nom = new Map((pac ?? []).map((p) => [p.id as string, p.name as string]))

const porNivel: Record<string, {env:number;sent:number;del:number;read:number;fail:number;resp:number}> = {}
console.log(`\n═══ RESCATE — ${lista.length} envíos ═══\n`)
for (const e of lista) {
  const n = String(e.details.nivel ?? '?')
  porNivel[n] ??= {env:0,sent:0,del:0,read:0,fail:0,resp:0}
  const g = porNivel[n]; g.env++
  const s = estado.get(e.details.wamid as string)
  const st2 = s?.status ?? (e.details.ok ? 'sent(sin callback)' : 'rechazado')
  if (st2 === 'read') { g.read++; g.del++ } else if (st2 === 'delivered') g.del++
  else if (st2 === 'failed') g.fail++
  else g.sent++
  const r = respondio.has(e.target_id); if (r) g.resp++
  const c = convDe.get(e.target_id)
  console.log(`  ${String(nom.get(e.target_id) ?? '').slice(0,30).padEnd(30)} ${n.toUpperCase()}  ${st2.padEnd(18)} ${s?.error_code ? '⚠️'+s.error_code : ''} ${r ? '💬 RESPONDIÓ' : ''} ${c ? `[${c.status}/${c.triage_state ?? '—'}]` : ''}`)
}
console.log('\n── por prioridad ──')
console.log('  nivel  enviados  entregados  leídos  fallidos  respondieron')
for (const [n,g] of Object.entries(porNivel)) {
  const pctDel = g.env ? Math.round(100*g.del/g.env) : 0
  console.log(`  ${n.toUpperCase().padEnd(6)} ${String(g.env).padStart(8)} ${String(g.del).padStart(11)} (${pctDel}%) ${String(g.read).padStart(6)} ${String(g.fail).padStart(9)} ${String(g.resp).padStart(13)}`)
}
const fails = lista.filter((e) => estado.get(e.details.wamid as string)?.error_code === 131042)
console.log(`\n  🚨 131042 en esta corrida: ${fails.length}`)
