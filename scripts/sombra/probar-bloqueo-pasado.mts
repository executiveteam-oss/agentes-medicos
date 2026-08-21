/** Llama al executor con la cita REAL ya pasada de una paciente y muestra qué
 *  recibe el modelo. Candado de escritura puesto: el chequeo de fecha corre
 *  ANTES de cualquier escritura, así que el bloqueo se ve igual que en prod. */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
const { supabaseAdmin } = await import('@/lib/supabase/admin')
let bloq = 0
{ type Q=Record<string,unknown>
  const noop=():Q=>{const s:Q={};const self=()=>s
    for(const m of ['select','eq','in','gte','lte','order','limit','single','maybeSingle','is','not']) s[m]=self
    s.then=(r:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(r);return s}
  const c=supabaseAdmin as unknown as {from:(t:string)=>Q;rpc:(...a:unknown[])=>unknown}
  const o=c.from.bind(c)
  c.from=(t:string)=>{const qb=o(t);for(const m of ['insert','update','delete','upsert']) qb[m]=()=>{bloq++;return noop()};return qb}
  c.rpc=()=>{bloq++;return noop()} }
const { executeTool } = await import('@/agents/tools/executor')
const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const APT=process.argv[2]
const { data: clinic } = await supabaseAdmin.from('clinics').select('*').eq('id',ALGIA).single()
const { data: doc } = await supabaseAdmin.from('doctors').select('*').eq('clinic_id',ALGIA).eq('is_active',true).limit(1).single()
for (const [tool, input] of [
  ['reschedule_appointment', { appointment_id: APT, new_starts_at: '2026-09-02T08:00:00-05:00' }],
  ['cancel_appointment', { appointment_id: APT, reason: 'no pudo ir' }],
] as Array<[string, Record<string, unknown>]>) {
  const r = await executeTool(tool, input, ALGIA, clinic as never, doc as never, null, null)
  const d = (r.data ?? {}) as Record<string, unknown>
  console.log(`\n══ ${tool} ══`)
  console.log(`  error   : ${r.error}`)
  console.log(`  outcome : ${d.outcome}`)
  console.log(`  LA PACIENTE LEE:\n${String(d.message_for_patient ?? '').split('\n').map(l=>'     '+l).join('\n')}`)
  console.log(`  cupos   : ${JSON.stringify(d.cupos_disponibles ?? null)}`)
}
console.log(`\nescrituras bloqueadas: ${bloq}\n`)
