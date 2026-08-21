/**
 * Corre una mini-conversación contra el agente REAL (runAppointmentAgent), con
 * el contexto real de una paciente real, y sin escribir una sola fila.
 *
 * A diferencia del replay de la sombra, acá NO se replica el loop: se llama la
 * función de producción. Es el modo de verificar un arreglo del agente sin
 * montar una conversación de WhatsApp.
 *
 * 🚨 READ-ONLY: candado duro sobre supabaseAdmin (insert/update/delete/upsert/
 * rpc neutralizados). Las tools de LECTURA corren de verdad; las de escritura
 * llegan al executor pero no pueden escribir — y en los caminos que nos importan
 * el executor valida ANTES de escribir, así que el bloqueo se ve igual que en
 * producción. No manda WhatsApp: no pasa por el webhook.
 *
 * Run: TZ=America/Bogota npx tsx scripts/sombra/simular-turno.mts <conversation_id> "msg1" ["msg2" …]
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
if (process.env.NODE_ENV !== 'development') (process.env as Record<string,string>).NODE_ENV='development'

const { supabaseAdmin } = await import('@/lib/supabase/admin')
let bloqueadas = 0
{
  type Q = Record<string, unknown>
  const noop = (): Q => { const s: Q = {}; const self = () => s
    for (const m of ['select','eq','neq','in','gte','lte','gt','lt','is','not','or','order','limit','range','match','filter','single','maybeSingle']) s[m] = self
    s.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r); return s }
  const c = supabaseAdmin as unknown as { from: (t: string) => Q; rpc: (...a: unknown[]) => unknown }
  const orig = c.from.bind(c)
  c.from = (t: string) => { const qb = orig(t)
    for (const m of ['insert','update','delete','upsert']) qb[m] = () => { bloqueadas++; return noop() }
    return qb }
  c.rpc = () => { bloqueadas++; return noop() }
}

const { runAppointmentAgent } = await import('@/agents/appointment-agent')
const { getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes, buildExistingPatient, resolveTratantesForClinic } = await import('@/lib/agent/agent-context')
const { detectarMencionDeMedico, leerPin } = await import('@/lib/agent/doctor-pin')
const { sanitizePatientMessage } = await import('@/lib/whatsapp/sanitize')
const { stripInternalMonologue } = await import('@/lib/whatsapp/strip-internal-monologue')
const { stripTimestampMarkers } = await import('@/lib/whatsapp/strip-timestamp-markers')
const G = await import('@/lib/whatsapp/agent-guards')
type Any = Record<string, unknown>

const convId = process.argv[2]
const mensajes = process.argv.slice(3)
if (!convId || mensajes.length === 0) { console.error('uso: simular-turno.mts <conversation_id> "msg" ...'); process.exit(1) }

const { data: conv } = await supabaseAdmin.from('conversations').select('id, clinic_id, context, patients(*)').eq('id', convId).single()
const patient = (conv as Any).patients as Any
const { data: clinicRow } = await supabaseAdmin.from('clinics').select('*').eq('id', (conv as Any).clinic_id as string).single()
const clinic = clinicRow as Any
const waConfig = getWhatsAppConfig(clinic as never) as unknown as Any
const doctors = await findActiveDoctors(clinic.id as string, waConfig as never) as unknown as Any[]
const consultationTypes = await findActiveConsultationTypes(clinic.id as string) as unknown as Any[]
const existingPatient = buildExistingPatient(patient as never)
const { tratanteMode, tratantes } = await resolveTratantesForClinic(clinic as never, patient as never, convId)

console.log(`\n═══ SIMULACIÓN · ${patient.name} · clínica ${clinic.name} ═══`)
console.log(`(candado de escritura activo · no se envía WhatsApp)\n`)

// El historial arranca VACÍO: simulamos la conversación desde cero, no la real.
const historia: Any[] = []
for (const cruda of mensajes) {
  const texto = sanitizePatientMessage(cruda)
  const pin = leerPin((conv as Any).context as never) ?? detectarMencionDeMedico(texto, doctors as never, { nombrePaciente: patient.name as string })
  const r = await runAppointmentAgent({
    patientMessage: texto, messageHistory: historia as never, clinic: clinic as never,
    doctor: doctors[0] as never, doctors: doctors as never, waConfig: waConfig as never,
    consultationTypes: consultationTypes as never, patientPhone: patient.phone as string,
    patientName: patient.name as string, patientId: patient.id as string,
    existingPatient: existingPatient as never, tratanteMode, tratantes, pinMedico: pin as never,
  })
  // Los mismos guards del webhook, en el mismo orden.
  let texto_final = r.text
  const guards = [
    G.detectHallucinatedCancellation({ agentText: r.text, toolsUsed: r.toolsUsed }),
    G.detectHallucinatedReschedule({ agentText: r.text, toolsUsed: r.toolsUsed }),
    G.detectHallucinatedIdentity({ agentText: r.text, messageHistory: historia as never, currentPatientMsg: texto,
      patientName: patient.name as string, patientDocType: patient.document_type as never, patientDocNumber: patient.document_number as never }),
  ].filter(Boolean) as Array<{ blocked: boolean; replacement?: string; reason?: string }>
  let bloqueo: string | null = null
  for (const g of guards) { if (g.blocked && g.replacement) { bloqueo = g.reason ?? 'guard'; texto_final = g.replacement; break } }
  texto_final = stripTimestampMarkers(stripInternalMonologue(texto_final).text).text

  console.log('─'.repeat(72))
  console.log(`PACIENTE : ${cruda}`)
  console.log(`  tools  : ${r.toolsUsed.length ? r.toolsUsed.join(', ') : '(ninguna)'}`)
  console.log(`  contrato: ${r.contratoDeSalida?.origen ?? '—'} (descartó ${r.contratoDeSalida?.descartados ?? 0})`)
  if (bloqueo) console.log(`  🔴 GUARD: ${bloqueo} → reemplazó el texto`)
  if (r.escalate) console.log(`  ⚠ escala: ${r.escalate.reason} / ${r.escalate.code}`)
  console.log(`AGENTE   :\n${texto_final.split('\n').map((l) => '   ' + l).join('\n')}`)

  historia.push({ role: 'patient', content: cruda, created_at: new Date().toISOString() })
  historia.push({ role: 'agent', content: texto_final, created_at: new Date().toISOString() })
}
console.log('─'.repeat(72))
console.log(`\nescrituras bloqueadas por el candado: ${bloqueadas}\n`)
