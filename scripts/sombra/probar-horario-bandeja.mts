/**
 * EVIDENCIA del horario de bandeja + de que lo que ya funcionaba no cambió.
 *
 * 1) El mensaje de escalación en martes 10 AM, sábado 8:21 AM y domingo.
 * 2) "¿están atendiendo?" contra el agente REAL — tiene que salir igual que hoy.
 * 3) Ningún médico de Algia perdió disponibilidad al sacar el fallback.
 *
 * 🚨 SOLO LECTURA. Candado duro sobre supabaseAdmin.
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
if (process.env.NODE_ENV !== 'development') (process.env as Record<string,string>).NODE_ENV='development'

const { supabaseAdmin } = await import('@/lib/supabase/admin')
let bloq = 0
{ type Q=Record<string,unknown>
  const noop=():Q=>{const s:Q={};const self=()=>s
    for(const m of ['select','eq','in','gte','lte','order','limit','single','maybeSingle','is','not','or','neq','gt','lt','range','match','filter']) s[m]=self
    s.then=(r:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(r);return s}
  const c=supabaseAdmin as unknown as {from:(t:string)=>Q;rpc:(...a:unknown[])=>unknown}
  const o=c.from.bind(c)
  c.from=(t:string)=>{const qb=o(t);for(const m of ['insert','update','delete','upsert']) qb[m]=()=>{bloq++;return noop()};return qb}
  c.rpc=()=>{bloq++;return noop()} }

const ALGIA='dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const { coletillaDeContacto } = await import('@/lib/clinic/inbox-hours')
const { data: cl } = await supabaseAdmin.from('clinics').select('*').eq('id', ALGIA).single()
const clinic = cl as Record<string, unknown>

// ── 1) El mensaje de escalación, con la lógica EXACTA de handleEscalateService ──
console.log('\n═══ 1) "Para la ecografía de mapeo…" en tres momentos ═══')
const cot=(iso:string)=>new Date(`${iso}-05:00`)
for (const [etiqueta, cuando] of [
  ['MARTES 10:00 (dentro)', '2026-08-25T10:00:00'],
  ['🔴 SÁBADO 08:21 (el caso real)', '2026-08-22T08:21:00'],
  ['DOMINGO 15:00', '2026-08-23T15:00:00'],
] as const) {
  const c = coletillaDeContacto(clinic.inbox_hours, cot(cuando))
  const msg = `Para la ecografía de mapeo, un asesor del consultorio confirma los detalles contigo antes de agendar. Ya les avisé.${c || ' Te contactan pronto. 🙂'}`
  console.log(`\n  ── ${etiqueta} ──\n  "${msg}"`)
}

// ── 2) "¿están atendiendo?" contra el agente real ──
console.log('\n\n═══ 2) "¿están atendiendo?" — el agente REAL ═══')
const { runAppointmentAgent } = await import('@/agents/appointment-agent')
const { getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes, buildExistingPatient } = await import('@/lib/agent/agent-context')
const wa = getWhatsAppConfig(clinic as never)
const docs = await findActiveDoctors(ALGIA, wa)
const cts = await findActiveConsultationTypes(ALGIA)
const { data: apt } = await supabaseAdmin.from('appointments').select('patients(*)')
  .eq('clinic_id', ALGIA).eq('status','confirmed').gte('starts_at', new Date().toISOString())
  .order('starts_at').limit(1).maybeSingle()
const patient = (apt as Record<string, unknown>).patients as Record<string, unknown>
for (const pregunta of ['Buenos días, ¿ustedes están atendiendo?', '¿En qué horario atienden?']) {
  const historia: Array<Record<string, unknown>> = []
  let ultimo = ''
  for (const t of [pregunta, 'sí', pregunta]) {
    const r = await runAppointmentAgent({
      patientMessage: t, messageHistory: historia as never, clinic: clinic as never,
      doctor: docs[0] as never, doctors: docs as never, waConfig: wa as never,
      consultationTypes: cts as never, patientPhone: patient.phone as string,
      patientName: patient.name as string, patientId: patient.id as string,
      existingPatient: buildExistingPatient(patient as never) as never,
      tratanteMode: 'off', tratantes: [], pinMedico: null,
    })
    // guardamos la última respuesta que NO sea la pregunta de identidad
    if (!/^[^\n]{0,40}¿eres [^?]+\?\s*$/i.test(r.text.trim())) ultimo = r.text
    historia.push({ role:'patient', content:t, created_at:new Date().toISOString() })
    historia.push({ role:'agent', content:ultimo, created_at:new Date().toISOString() })
  }
  console.log(`\n  ── "${pregunta}" ──\n  ${ultimo.replace(/\n/g,'\n  ').slice(0,500)}`)
}

// ── 3) ¿Algún médico de Algia perdió disponibilidad? ──
console.log('\n\n═══ 3) Disponibilidad de los 8 médicos, con el fallback ya fuera ═══')
const { traerDisponibilidadDia } = await import('@/lib/calendar/fetch-day-availability')
const DIAS = ['2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-29']
let sinNada = 0
for (const d of docs as unknown as Array<Record<string, unknown>>) {
  const conFranjas: string[] = []
  for (const f of DIAS) {
    const disp = await traerDisponibilidadDia(ALGIA, d.id as string, f, clinic as never)
    if (disp.atiende && disp.franjas.length > 0) conFranjas.push(f.slice(5))
  }
  if (conFranjas.length === 0) sinNada++
  console.log(`  ${conFranjas.length > 0 ? '✅' : '🔴'} ${String(d.name).split(/\s+/).slice(0,2).join(' ').padEnd(18)} días con franjas: ${conFranjas.join(' ') || 'NINGUNO'}`)
}
console.log(`\n  médicos que quedaron sin disponibilidad: ${sinNada}`)
console.log(`  escrituras bloqueadas: ${bloq}\n`)
