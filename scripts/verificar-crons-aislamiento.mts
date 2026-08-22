/**
 * LOS 11 CRONS, CON LAS DOS CLÍNICAS VIVAS — ¿cada una recibió sólo lo suyo?
 *
 * Dos formas de comprobarlo, según lo que hace cada cron:
 *  A) Los que NO envían nada a pacientes se INVOCAN de verdad, con el candado
 *     de escritura puesto, y se mira su salida.
 *  B) Los que envían WhatsApp NO se invocan: se replica su query de selección
 *     por clínica y se verifica que ninguna fila sea de otra.
 *
 * 🚨 SOLO LECTURA: candado duro sobre supabaseAdmin (insert/update/delete/
 * upsert/rpc). Ningún mensaje sale.
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
if (process.env.NODE_ENV !== 'development') (process.env as Record<string,string>).NODE_ENV='development'

const { supabaseAdmin } = await import('@/lib/supabase/admin')
let bloqueadas = 0
{ type Q=Record<string,unknown>
  const noop=():Q=>{const s:Q={};const self=()=>s
    for(const m of ['select','eq','in','gte','lte','order','limit','single','maybeSingle','is','not','or','neq','gt','lt','range','match','filter']) s[m]=self
    s.then=(r:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:null,count:0}).then(r);return s}
  const c=supabaseAdmin as unknown as {from:(t:string)=>Q;rpc:(...a:unknown[])=>unknown}
  const o=c.from.bind(c)
  c.from=(t:string)=>{const qb=o(t);for(const m of ['insert','update','delete','upsert']) qb[m]=()=>{bloqueadas++;return noop()};return qb}
  c.rpc=()=>{bloqueadas++;return noop()} }

const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb', PUCHIS='e7cc72ca-30d1-4b59-bebc-e340c09f3507'
const NOMBRE:Record<string,string>={[ALGIA]:'ALGIA',[PUCHIS]:'Los Puchis'}

const { clinicasVivas } = await import('@/lib/clinic/clinicas-vivas')
const vivas = await clinicasVivas<{id:string;name:string}>('id, name')
console.log(`\n═══ CRONS · clínicas vivas: ${vivas.length} ═══`)
console.log(`   ${vivas.map((c)=>c.name.trim()).join(' · ')}\n`)

// ── A) Los que NO envían: invocación real ──────────────────────────
const SOLO = (() => { const i = process.argv.indexOf('--solo'); return i > 0 ? process.argv[i+1] : null })()
const SECRET = process.env.CRON_SECRET ?? ''
const req = (u: string) => new Request(u, { headers: { authorization: `Bearer ${SECRET}` } }) as never
console.log('▸ A) INVOCADOS DE VERDAD (no envían nada a pacientes)')
const conTimeout = <T,>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms en ${etiqueta}`)), ms))])
for (const [nombre, mod] of [
  ['escalate-coverage-check', '@/app/api/cron/escalate-coverage-check/route'],
  ['reopen-agendas',          '@/app/api/cron/reopen-agendas/route'],
  ['cleanup-notifications',   '@/app/api/cron/cleanup-notifications/route'],
] as const) {
  if (SOLO && SOLO !== nombre) { console.log(`   ${nombre.padEnd(26)} (saltado)`); continue }
  try {
    const { GET } = await conTimeout(import(mod), 60_000, `import ${nombre}`)
    const res = await conTimeout(GET(req(`https://x/api/cron/${nombre}`)) as Promise<Response>, 90_000, nombre)
    const body = await (res as Response).json()
    console.log(`   ${nombre.padEnd(26)} status=${(res as Response).status}  ${JSON.stringify(body).slice(0,160)}`)
  } catch (e) {
    console.log(`   ${nombre.padEnd(26)} 🔴 ${e instanceof Error ? e.message : e}`)
  }
}

// ── B) Los que envían: selección por clínica, sin invocar ──────────
console.log('\n▸ B) LOS QUE ENVÍAN — qué filas seleccionaría cada uno, por clínica')
const ahora = new Date().toISOString()
const en48h = new Date(Date.now()+48*3600e3).toISOString()
const hace30d = new Date(Date.now()-30*24*3600e3).toISOString()
const SELECCIONES: Array<{cron:string; tabla:string; q:(cid:string)=>PromiseLike<{data:unknown}>}> = [
  { cron:'send-reminders',       tabla:'appointments',
    q:(cid)=>supabaseAdmin.from('appointments').select('id, clinic_id').eq('clinic_id',cid).gte('starts_at',ahora).lte('starts_at',en48h).in('status',['confirmed','rescheduled']) },
  { cron:'survey-post-consulta', tabla:'appointments',
    q:(cid)=>supabaseAdmin.from('appointments').select('id, clinic_id').eq('clinic_id',cid).lt('starts_at',ahora).eq('survey_sent',false).limit(500) },
  { cron:'post-consulta',        tabla:'appointments',
    q:(cid)=>supabaseAdmin.from('appointments').select('id, clinic_id').eq('clinic_id',cid).lt('starts_at',ahora).limit(500) },
  { cron:'reactivacion',         tabla:'patients',
    q:(cid)=>supabaseAdmin.from('patients').select('id, clinic_id').eq('clinic_id',cid).limit(500) },
  { cron:'morning-report',       tabla:'appointments',
    q:(cid)=>supabaseAdmin.from('appointments').select('id, clinic_id').eq('clinic_id',cid).gte('starts_at',ahora).limit(500) },
  { cron:'weekly-report',        tabla:'appointments',
    q:(cid)=>supabaseAdmin.from('appointments').select('id, clinic_id').eq('clinic_id',cid).gte('starts_at',hace30d).limit(1000) },
  { cron:'document-retention',   tabla:'conversation_media',
    q:(cid)=>supabaseAdmin.from('conversation_media').select('id, clinic_id').eq('clinic_id',cid).limit(500) },
  { cron:'sync/isalud',          tabla:'sync_integrations',
    q:(cid)=>supabaseAdmin.from('sync_integrations').select('id, clinic_id').eq('clinic_id',cid) },
]
let fallas=0
for (const s of SELECCIONES) {
  const partes: string[] = []
  for (const cid of [ALGIA, PUCHIS]) {
    const { data } = await s.q(cid)
    const filas=(data??[]) as Array<{clinic_id:string}>
    const ajenas=filas.filter((f)=>f.clinic_id!==cid).length
    if (ajenas>0) fallas++
    partes.push(`${NOMBRE[cid]}=${filas.length}${ajenas?` 🔴ajenas=${ajenas}`:''}`)
  }
  console.log(`   ${fallas?'🔴':'✅'} ${s.cron.padEnd(22)} [${s.tabla}]  ${partes.join('  ·  ')}`)
}

console.log(`\n${fallas===0?'✅ ningún cron selecciona una fila de otra clínica':`🔴 ${fallas} cruces`}`)
console.log(`escrituras bloqueadas por el candado: ${bloqueadas}\n`)
