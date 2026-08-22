/**
 * INCIDENTE CANAL ROTO — reapertura por plantilla. Autorización: gerente de
 * Algia, 2026-08-22 ("Proceda"), registrada en audit_log como algia_22ago.
 *
 * Manda `contacto_general` (UTILITY, es_CO, APPROVED) al universo con evidencia
 * de afectación. NO manda al padrón: sólo a las listas P1/P4 construidas por
 * "cero mensajes entrantes desde la migración del número (2026-06-03)".
 *
 * Run: TZ=America/Bogota npx tsx scripts/canal-reabierto-migracion.mts <p1|p4> [--limite N] [--enviar]
 *      Sin --enviar hace DRY RUN y no manda nada.
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
if (process.env.NODE_ENV !== 'development') (process.env as Record<string,string>).NODE_ENV='development'

const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const MIGRACION='2026-06-03 00:00:00-05'
const CLINICA_EN_MENSAJE='Algia'   // literal: clinics.name está en MAYÚSCULAS
const AUTORIZACION='algia_22ago'

const TEXTOS = {
  p1: 'Tienes una cita próxima con nosotros y queremos confirmar que tienes este chat activo para cualquier cosa que necesites — puedes confirmar tu cita, cambiarla o resolver dudas por acá. Respóndenos cuando quieras.',
  p4: 'Queremos que tengas siempre a mano este chat para agendar tu próxima cita o resolver cualquier duda. Escríbenos cuando lo necesites.',
} as const

const nivel = (process.argv[2] ?? '').toLowerCase() as 'p1'|'p4'
if (nivel !== 'p1' && nivel !== 'p4') { console.error('uso: <p1|p4> [--limite N] [--enviar]'); process.exit(1) }
const iL = process.argv.indexOf('--limite')
const LIMITE = iL > 0 ? Number(process.argv[iL+1]) : 0
const ENVIAR = process.argv.includes('--enviar')

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/client')

const { data: cl } = await db.from('clinics').select('whatsapp_phone_id, whatsapp_access_token').eq('id', ALGIA).single()
const creds = { phoneNumberId: (cl as Record<string,string>).whatsapp_phone_id, accessToken: (cl as Record<string,string>).whatsapp_access_token }

// ── La lista, con el MISMO SQL que se reportó ────────────────────────
// La lista se arma con el cliente (mismo criterio que el SQL reportado).
type Fila = { id: string; name: string; phone: string; prox: string | null }
// 🔴 PostgREST corta en 1.000 filas aunque pidas más: hay que paginar.
// Ya mordió antes en esta misma tarea — sin esto, `base` traía 1.000 de 14.887
// y la lista salía vacía sin ningún error.
async function traerTodos<T>(tabla: string, cols: string, filtro: (q: never) => never): Promise<T[]> {
  const out: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const q = filtro(db.from(tabla).select(cols) as never) as never as { range: (a:number,b:number)=>PromiseLike<{data:T[]|null}> }
    const { data } = await q.range(desde, desde + 999)
    const filas = data ?? []
    out.push(...filas)
    if (filas.length < 1000) break
  }
  return out
}
type Pac = { id: string; name: string; phone: string }
const base = await traerTodos<Pac>('patients', 'id, name, phone',
  ((q: { eq: (a:string,b:unknown)=>unknown }) => (q.eq('clinic_id', ALGIA) as { eq:(a:string,b:unknown)=>unknown }).eq('proactive_contact_opt_in', true)) as never)
const conMsg = new Set<string>()
{
  const { data: convs } = await db.from('conversations').select('id, patient_id').eq('clinic_id', ALGIA)
  const mapa = new Map((convs ?? []).map((c) => [c.id as string, c.patient_id as string]))
  const claves = [...mapa.keys()]
  const msgs = await traerTodos<{conversation_id:string}>('messages','conversation_id',
    ((q: { in:(a:string,b:unknown)=>unknown }) => ((q.in('conversation_id', claves) as { eq:(a:string,b:unknown)=>unknown })
      .eq('role','patient') as { gte:(a:string,b:unknown)=>unknown }).gte('created_at', new Date(MIGRACION).toISOString())) as never)
  for (const m of msgs) { const pid = mapa.get(m.conversation_id); if (pid) conMsg.add(pid) }
}
const validos = base.filter((p) => /^\+?57[0-9]{10}$/.test(String(p.phone ?? '')) && !conMsg.has(p.id as string))
// 🔴 NADA de .in() con 14.000 ids: revienta el largo de la URL y PostgREST
// devuelve vacío SIN error. Se traen las citas por clínica —que son cientos— y
// se cruzan en memoria contra el set de pacientes válidos.
const validSet = new Set(validos.map((p) => p.id))
const citas = await traerTodos<{patient_id:string;starts_at:string;status:string}>(
  'appointments', 'patient_id, starts_at, status',
  ((q: { eq:(a:string,b:unknown)=>unknown }) => ((q.eq('clinic_id', ALGIA) as { gte:(a:string,b:unknown)=>unknown })
    .gte('starts_at', new Date(Date.now()-365*864e5).toISOString())) as never) as never)
const prox = new Map<string,string>()
const conteo = new Map<string,number>()
const ahoraISO = new Date().toISOString()
const en14 = new Date(Date.now()+14*864e5).toISOString()
for (const a of citas) {
  if (!validSet.has(a.patient_id)) continue
  conteo.set(a.patient_id, (conteo.get(a.patient_id) ?? 0) + 1)
  if (['confirmed','rescheduled'].includes(a.status) && a.starts_at >= ahoraISO && a.starts_at <= en14) {
    const v = prox.get(a.patient_id)
    if (!v || a.starts_at < v) prox.set(a.patient_id, a.starts_at)
  }
}

let lista: Fila[] = nivel === 'p1'
  ? validos.filter((p) => prox.has(p.id as string))
      .map((p) => ({ id:p.id as string, name:p.name as string, phone:p.phone as string, prox: prox.get(p.id as string)! }))
      .sort((a,b) => a.prox!.localeCompare(b.prox!))
  : validos.filter((p) => !prox.has(p.id as string) && (conteo.get(p.id as string) ?? 0) >= 2)
      .map((p) => ({ id:p.id as string, name:p.name as string, phone:p.phone as string, prox: null }))
      .sort((a,b) => a.name.localeCompare(b.name))
if (LIMITE > 0) lista = lista.slice(0, LIMITE)

console.log(`[debug] base=${base.length} conMsg=${conMsg.size} validos=${validos.length} conCitaProx=${prox.size} conHistorial=${conteo.size}`)
const hora=(s:string|null)=>s? new Date(s).toLocaleString('es-CO',{timeZone:'America/Bogota',dateStyle:'short',timeStyle:'short'}):'—'
console.log(`\n═══ ${nivel.toUpperCase()} · ${lista.length} pacientes · ${ENVIAR?'🚨 ENVÍO REAL':'DRY RUN'} ═══`)
console.log(`plantilla: contacto_general [es_CO] · {{2}} = "${CLINICA_EN_MENSAJE}"\n`)
for (const f of lista) console.log(`  ${(f.name||'').slice(0,34).padEnd(34)} ${f.phone.padEnd(14)} cita: ${hora(f.prox)}`)
if (!ENVIAR) { console.log('\n(dry run — no se envió nada)\n'); process.exit(0) }

const wamids: Array<{patient_id:string; name:string; phone:string; wamid:string|null; ok:boolean; error?:string}> = []
let ok=0, fail=0
for (const f of lista) {
  const primerNombre = (f.name || '').trim().split(/\s+/)[0] || 'Hola'
  const r = await sendWhatsAppTemplate(
    f.phone.replace(/^\+/,''), 'contacto_general', 'es_CO',
    [primerNombre, CLINICA_EN_MENSAJE, TEXTOS[nivel]], null, creds,
    // 'contacto_general' es el sendType del union que corresponde a esta
    // plantilla. El motivo del incidente va en audit_log, no acá.
    { clinicId: ALGIA, sendType: 'contacto_general' },
  )
  const res = r as unknown as { ok?: boolean; success?: boolean; messageId?: string; wamid?: string; error?: string }
  const bien = Boolean(res.ok ?? res.success)
  const wamid = res.messageId ?? res.wamid ?? null
  wamids.push({ patient_id:f.id, name:f.name, phone:f.phone, wamid, ok:bien, error:res.error })
  bien ? ok++ : fail++
  console.log(`  ${bien?'✅':'🔴'} ${(f.name||'').slice(0,30).padEnd(30)} ${wamid ?? res.error ?? ''}`)
  await db.from('audit_log').insert({
    clinic_id: ALGIA, action: 'canal_reabierto_migracion', actor_type: 'system',
    target_type: 'patient', target_id: f.id,
    details: { nivel, autorizacion: AUTORIZACION, template: 'contacto_general',
               wamid, ok: bien, error: res.error ?? null, prox_cita: f.prox },
  })
  await new Promise((r2) => setTimeout(r2, 1200))
}
console.log(`\n── ${nivel.toUpperCase()}: ${ok} aceptados por Meta · ${fail} rechazados ──\n`)
