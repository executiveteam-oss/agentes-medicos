import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
if (process.env.NODE_ENV!=='development') (process.env as Record<string,string>).NODE_ENV='development'
const { supabaseAdmin } = await import('@/lib/supabase/admin')
let bloq=0
{ type Q=Record<string,unknown>
  const noop=():Q=>{const s:Q={};const self=()=>s
    for(const m of ['select','eq','in','gte','lte','order','limit','single','maybeSingle','is','not','or']) s[m]=self
    s.then=(r:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(r);return s}
  const c=supabaseAdmin as unknown as {from:(t:string)=>Q;rpc:(...a:unknown[])=>unknown}
  const o=c.from.bind(c)
  c.from=(t:string)=>{const qb=o(t);for(const m of ['insert','update','delete','upsert']) qb[m]=()=>{bloq++;return noop()};return qb}
  c.rpc=()=>{bloq++;return noop()} }
const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const ANGELICA='6a0c89a0-539e-4d75-a841-5742b3c9bd5b'
const { executeTool } = await import('@/agents/tools/executor')
const { data: cl } = await supabaseAdmin.from('clinics').select('*').eq('id',ALGIA).single()
const { data: doc } = await supabaseAdmin.from('doctors').select('*').eq('id',ANGELICA).single()

console.log('── qué devuelve check_availability para un MIÉRCOLES (no atiende) ──')
const r = await executeTool('check_availability', { doctor_id: ANGELICA, preferred_date: '2026-08-26' },
  ALGIA, cl as never, doc as never, null, null)
console.log(JSON.stringify(r.data, null, 2).slice(0, 900))

console.log('\n── y para un día que SÍ atiende: ¿los slots traen el día? ──')
const r2 = await executeTool('check_availability', { doctor_id: ANGELICA, preferred_date: '2026-08-27' },
  ALGIA, cl as never, doc as never, null, null)
const d2 = r2.data as Record<string, unknown>
console.log('  campos de data:', Object.keys(d2).join(', '))
console.log('  dayOfWeek:', d2.dayOfWeek)
console.log('  primer slot:', JSON.stringify((d2.slots as unknown[])?.[0]))
console.log(`\nescrituras bloqueadas: ${bloq}`)
