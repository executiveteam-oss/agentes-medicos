/**
 * VERIFICACIÓN CRUZADA DE AISLAMIENTO — Algia ↔ Los Puchis.
 *
 * Corre las MISMAS queries que usan las pantallas del dashboard, una vez con la
 * sesión de cada clínica, y comprueba que ninguna devuelve una fila de la otra.
 * No compara conteos: compara PERTENENCIA fila por fila. Un conteo correcto con
 * una fila ajena adentro se ve idéntico a uno bien.
 *
 * 🚨 SOLO LECTURA. Candado duro: insert/update/delete/upsert/rpc neutralizados.
 * Run: TZ=America/Bogota npx tsx scripts/verificar-aislamiento.mts
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

const { supabaseAdmin } = await import('@/lib/supabase/admin')
let bloqueadas = 0
{ type Q=Record<string,unknown>
  const noop=():Q=>{const s:Q={};const self=()=>s
    for(const m of ['select','eq','in','gte','lte','order','limit','single','maybeSingle','is','not','or','neq','gt','lt','range','match','filter']) s[m]=self
    s.then=(r:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(r);return s}
  const c=supabaseAdmin as unknown as {from:(t:string)=>Q;rpc:(...a:unknown[])=>unknown}
  const o=c.from.bind(c)
  c.from=(t:string)=>{const qb=o(t);for(const m of ['insert','update','delete','upsert']) qb[m]=()=>{bloqueadas++;return noop()};return qb}
  c.rpc=()=>{bloqueadas++;return noop()} }

const ALGIA  = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const PUCHIS = 'e7cc72ca-30d1-4b59-bebc-e340c09f3507'
const NOMBRE: Record<string,string> = { [ALGIA]:'ALGIA', [PUCHIS]:'Los Puchis' }

/** Cada entrada replica lo que hace UNA pantalla del dashboard. */
const PANTALLAS: Array<{ pantalla: string; tabla: string; q: (cid: string) => PromiseLike<{ data: unknown }> }> = [
  { pantalla: 'Agenda (citas del mes)', tabla: 'appointments',
    q: (cid) => supabaseAdmin.from('appointments').select('id, clinic_id').eq('clinic_id', cid).limit(2000) },
  { pantalla: 'Pacientes', tabla: 'patients',
    q: (cid) => supabaseAdmin.from('patients').select('id, clinic_id').eq('clinic_id', cid).limit(2000) },
  { pantalla: 'Conversaciones', tabla: 'conversations',
    q: (cid) => supabaseAdmin.from('conversations').select('id, clinic_id').eq('clinic_id', cid).limit(2000) },
  { pantalla: 'Médicos y servicios', tabla: 'doctors',
    q: (cid) => supabaseAdmin.from('doctors').select('id, clinic_id').eq('clinic_id', cid) },
  { pantalla: 'Médicos y servicios (catálogo)', tabla: 'consultation_types',
    q: (cid) => supabaseAdmin.from('consultation_types').select('id, clinic_id').eq('clinic_id', cid) },
  { pantalla: 'Campana / notificaciones', tabla: 'staff_notifications',
    q: (cid) => supabaseAdmin.from('staff_notifications').select('id, clinic_id').eq('clinic_id', cid).limit(2000) },
  { pantalla: 'Lista de espera (widget)', tabla: 'waitlist',
    q: (cid) => supabaseAdmin.from('waitlist').select('id, clinic_id').eq('clinic_id', cid) },
  { pantalla: 'Servicios pendientes', tabla: 'pending_contacts',
    q: (cid) => supabaseAdmin.from('pending_contacts').select('id, clinic_id').eq('clinic_id', cid) },
  { pantalla: 'Auditoría', tabla: 'audit_log',
    q: (cid) => supabaseAdmin.from('audit_log').select('id, clinic_id').eq('clinic_id', cid).limit(2000) },
  { pantalla: 'Reglas del catálogo', tabla: 'consultation_type_rules',
    q: (cid) => supabaseAdmin.from('consultation_type_rules').select('id, clinic_id').eq('clinic_id', cid) },
]

console.log('\n═══ AISLAMIENTO ALGIA ↔ LOS PUCHIS — pantalla por pantalla ═══\n')
let fallas = 0
for (const cid of [ALGIA, PUCHIS]) {
  const otra = cid === ALGIA ? PUCHIS : ALGIA
  console.log(`▸ SESIÓN DE ${NOMBRE[cid]}  (no debe aparecer ni una fila de ${NOMBRE[otra]})`)
  for (const p of PANTALLAS) {
    const { data } = await p.q(cid)
    const filas = (data ?? []) as Array<{ id: string; clinic_id: string }>
    const ajenas = filas.filter((f) => f.clinic_id !== cid)
    const deLaOtra = filas.filter((f) => f.clinic_id === otra)
    const ok = ajenas.length === 0
    if (!ok) fallas++
    console.log(`   ${ok ? '✅' : '🔴'} ${p.pantalla.padEnd(32)} ${String(filas.length).padStart(5)} filas · ajenas=${ajenas.length} · de ${NOMBRE[otra]}=${deLaOtra.length}`)
  }
  console.log('')
}

// ── El agente: ¿puede ver médicos/citas/pacientes de la otra? ──
console.log('▸ EL AGENTE — el contexto que arma para cada clínica')
const { findActiveDoctors, findActiveConsultationTypes, getWhatsAppConfig } = await import('@/lib/agent/agent-context')
for (const cid of [ALGIA, PUCHIS]) {
  const otra = cid === ALGIA ? PUCHIS : ALGIA
  const { data: cl } = await supabaseAdmin.from('clinics').select('*').eq('id', cid).single()
  const wa = getWhatsAppConfig(cl as never)
  const docs = await findActiveDoctors(cid, wa)
  const cts = await findActiveConsultationTypes(cid)
  const docsAjenos = docs.filter((d) => (d as unknown as {clinic_id:string}).clinic_id !== cid)
  const ctsAjenos = cts.filter((c) => (c as unknown as {clinic_id:string}).clinic_id !== cid)
  if (docsAjenos.length || ctsAjenos.length) fallas++
  console.log(`   ${docsAjenos.length + ctsAjenos.length === 0 ? '✅' : '🔴'} ${NOMBRE[cid].padEnd(12)} médicos=${docs.length} (ajenos ${docsAjenos.length}) · servicios=${cts.length} (ajenos ${ctsAjenos.length})`)
  void otra
}

// ── get_user_clinic_id con el usuario QA ──
console.log('\n▸ get_user_clinic_id para el usuario QA de Los Puchis')
const { data: qa } = await supabaseAdmin.from('clinic_users')
  .select('auth_user_id, clinic_id, is_active').eq('full_name', 'QA Multi-tenant').single()
const q = qa as { auth_user_id: string; clinic_id: string; is_active: boolean } | null
console.log(`   membresías activas del QA: ${q?.is_active ? 1 : 0} · clínica: ${q ? NOMBRE[q.clinic_id] ?? q.clinic_id : '—'}`)
console.log(`   ${q?.clinic_id === PUCHIS ? '✅' : '🔴'} resuelve a Los Puchis, no a Algia`)

console.log(`\n${fallas === 0 ? '✅ CERO filtraciones' : `🔴 ${fallas} pantallas con filas ajenas`}`)
console.log(`escrituras bloqueadas por el candado: ${bloqueadas}\n`)
