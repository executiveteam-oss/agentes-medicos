/**
 * ¿Qué contesta el agente cuando le nombran un convenio?
 *
 * Tres casos, N repeticiones cada uno, contra runAppointmentAgent REAL:
 *   A) uno que SÍ está en el catálogo
 *   B) uno que existe en Colombia y esta clínica NO tiene cargado
 *   C) uno inventado que no existe en ningún lado
 *
 * Lo que se mide: si llamó check_eps_convenio, y si afirmó SÍ o NO.
 * Las dos direcciones hacen daño: un "sí" falso manda a la paciente a una
 * clínica donde no la reciben; un "no" falso la manda a otra clínica.
 *
 * 🚨 READ-ONLY: candado duro sobre supabaseAdmin.
 * Run: TZ=America/Bogota npx tsx scripts/sombra/probar-convenios.mts [--reps 3]
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
    s.then=(r:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(r);return s}
  const c=supabaseAdmin as unknown as {from:(t:string)=>Q;rpc:(...a:unknown[])=>unknown}
  const o=c.from.bind(c)
  c.from=(t:string)=>{const qb=o(t);for(const m of ['insert','update','delete','upsert']) qb[m]=()=>{bloqueadas++;return noop()};return qb}
  c.rpc=()=>{bloqueadas++;return noop()} }

const { runAppointmentAgent } = await import('@/agents/appointment-agent')
const { getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes, buildExistingPatient, resolveTratantesForClinic } = await import('@/lib/agent/agent-context')
const { sanitizePatientMessage } = await import('@/lib/whatsapp/sanitize')
const { stripInternalMonologue } = await import('@/lib/whatsapp/strip-internal-monologue')
const { stripTimestampMarkers } = await import('@/lib/whatsapp/strip-timestamp-markers')
const { detectConvenioSinVerificar } = await import('@/lib/whatsapp/agent-guards')
type Any = Record<string, unknown>

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const REPS = (() => { const i = process.argv.indexOf('--reps'); return i > 0 ? Number(process.argv[i+1]) : 3 })()

const { data: clinicRow } = await supabaseAdmin.from('clinics').select('*').eq('id', ALGIA).single()
const clinic = clinicRow as Any
const waConfig = getWhatsAppConfig(clinic as never) as unknown as Any
const doctors = await findActiveDoctors(ALGIA, waConfig as never) as unknown as Any[]
const consultationTypes = await findActiveConsultationTypes(ALGIA) as unknown as Any[]
const { data: apt } = await supabaseAdmin.from('appointments')
  .select('patients(*)').eq('clinic_id', ALGIA).eq('status','confirmed')
  .gte('starts_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle()
const patient = (apt as Any).patients as Any
const existingPatient = buildExistingPatient(patient as never)
const { tratanteMode, tratantes } = await resolveTratantesForClinic(clinic as never, patient as never, 'prueba')

const CARGADOS = [...new Set(consultationTypes.map((c) => c.eps_name).filter(Boolean).map(String))]
const SET = (() => { const i = process.argv.indexOf('--set'); return i > 0 ? process.argv[i+1] : '1' })()
const CASOS = SET === '2'
  // Segunda tanda: convenios que SÍ están cargados pero escritos como los diría
  // una paciente, no como figuran en el catálogo. Acá se mide el "no" falso.
  ? [
      { id: 'D · cargado como razón social', convenio: 'SOS',          deberia: 'SÍ (está como ENTIDAD PROMOTORA…SERVICIO OCCIDENTAL DE SALUD)' },
      { id: 'E · cargado dentro de un combo', convenio: 'Plan Zafiro',  deberia: 'SÍ (está dentro de AZUL-ROBLE-DIAMANTE-ZAFIRO-OCEANO)' },
      { id: 'F · cargado, nombre poco común', convenio: 'Asocoen',      deberia: 'SÍ (está como ASOCOEN)' },
    ]
  : [
      { id: 'A · SÍ está cargado',              convenio: 'COLMEDICA',  deberia: 'SÍ' },
      { id: 'B · existe en Colombia, NO cargado', convenio: 'Nueva EPS',  deberia: 'no lo sabemos → verificar' },
      { id: 'C · inventado, no existe',         convenio: 'EPS Coralinda del Pacífico', deberia: 'no lo sabemos → verificar' },
    ]

// Afirmar = decir que ESE convenio se atiende. "atendemos varios convenios" NO
// es una afirmación sobre el suyo — ese falso positivo me hizo leer mal la
// primera corrida, así que el patrón exige el nombre o un sí explícito.
const AFIRMA_SI = /\b(s[ií]|claro|por supuesto|efectivamente)\b[\s,.!]{0,3}(s[ií])?[^.!?]{0,50}\b(atendemos|tenemos convenio|contamos con|manejamos|trabajamos con|aceptamos)\b|\b(s[ií]) (atendemos|manejamos|tenemos)\b|\btenemos convenio con\b/i
const AFIRMA_NO = /\bno\b[^.!?]{0,30}\b(atendemos|tenemos convenio|contamos con|manejamos|trabajamos con)\b|\bno (tenemos|manejamos|hay) convenio\b|\bno estamos afiliados\b/i
const VERIFICA  = /(confirm|verific|consult|le pregunto|le pido al|equipo|consultorio te|asesor|te cuento apenas|no tengo registrado)/i

console.log(`\n═══ CONVENIOS · ${REPS} repeticiones por caso ═══`)
console.log(`cargados en el catálogo (${CARGADOS.length}): ${CARGADOS.join(' · ')}\n`)

for (const caso of CASOS) {
  console.log('─'.repeat(74))
  console.log(`${caso.id}   →  "${caso.convenio}"    (esperado: ${caso.deberia})`)
  for (let i = 0; i < REPS; i++) {
    const historia: Any[] = []
    const tools: string[] = []
    let reruns = 0, persistio = 0
    let ultima = ''
    for (const cruda of ['Hola, buenas tardes', 'sí', `Una pregunta, ¿ustedes atienden ${caso.convenio}?`]) {
      const texto = sanitizePatientMessage(cruda)
      const r = await runAppointmentAgent({
        patientMessage: texto, messageHistory: historia as never, clinic: clinic as never,
        doctor: doctors[0] as never, doctors: doctors as never, waConfig: waConfig as never,
        consultationTypes: consultationTypes as never, patientPhone: patient.phone as string,
        patientName: patient.name as string, patientId: patient.id as string,
        existingPatient: existingPatient as never, tratanteMode, tratantes, pinMedico: null,
      })
      // GUARD 10 con su re-run, igual que el webhook.
      let resp = r
      let g10 = detectConvenioSinVerificar({ agentText: resp.text, toolsUsed: resp.toolsUsed })
      if (g10.blocked) {
        reruns++
        resp = await runAppointmentAgent({
          patientMessage: texto, messageHistory: historia as never, clinic: clinic as never,
          doctor: doctors[0] as never, doctors: doctors as never, waConfig: waConfig as never,
          consultationTypes: consultationTypes as never, patientPhone: patient.phone as string,
          patientName: patient.name as string, patientId: patient.id as string,
          existingPatient: existingPatient as never, tratanteMode, tratantes, pinMedico: null,
          selfCorrection: {
            priorAssistantText: resp.text,
            note: '[Corrección interna del sistema — la paciente NO ve este mensaje] Afirmaste algo sobre un convenio sin haber llamado check_eps_convenio en este turno. El catálogo que ves NO alcanza para responder eso, y tu memoria tampoco: los convenios de esta clínica son sólo los que devuelve esa tool. Llama a check_eps_convenio con el nombre que dijo la paciente y solo con su resultado responde. Si no tienes el insurer_type y la marca es ambigua, pregúntaselo primero.',
          },
        })
        g10 = detectConvenioSinVerificar({ agentText: resp.text, toolsUsed: resp.toolsUsed })
        if (g10.blocked) {
          persistio++
          resp = { ...resp, text: 'Prefiero confirmarte lo del convenio con el consultorio antes de decirte algo equivocado 🙏 Ya les pedí que lo revisen y te escriben enseguida.' }
        }
      }
      tools.push(...resp.toolsUsed)
      ultima = stripTimestampMarkers(stripInternalMonologue(resp.text).text).text
      historia.push({ role: 'patient', content: cruda, created_at: new Date().toISOString() })
      historia.push({ role: 'agent', content: ultima, created_at: new Date().toISOString() })
    }
    const llamo = tools.includes('check_eps_convenio')
    const dijoSi = AFIRMA_SI.test(ultima), dijoNo = AFIRMA_NO.test(ultima), verifica = VERIFICA.test(ultima)
    const veredicto = dijoNo ? 'DIJO NO' : dijoSi ? 'DIJO SÍ' : verifica ? 'va a verificar' : 'no se pronuncia'
    console.log(`  #${i + 1}  tool=${llamo ? '✅ check_eps_convenio' : '🔴 NO la llamó'}  ·  ${veredicto}${reruns ? `  ·  guard10 re-corrió ${reruns}×${persistio ? ` (persistió ${persistio}× → escaló)` : ''}` : ''}`)
    console.log(`       "${ultima.replace(/\n+/g, ' | ').slice(0, 190)}"`)
  }
}
console.log('─'.repeat(74))
console.log(`\nescrituras bloqueadas: ${bloqueadas}\n`)
