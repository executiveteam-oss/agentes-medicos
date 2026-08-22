/**
 * EVIDENCIA DEL DESTRABE DEL CORTE POR ESCALADA.
 *
 * Corre la decisión REAL (decidirCorteDeEscalada) con el hecho REAL de la base
 * (¿hay algún mensaje role='staff'?) sobre TODAS las conversaciones escaladas
 * de la clínica, y después simula tres casos con el agente de producción.
 *
 * 🚨 READ-ONLY: mismo candado duro que el resto de la sombra — insert/update/
 * delete/upsert/rpc neutralizados sobre supabaseAdmin. No manda WhatsApp.
 *
 * Run: TZ=America/Bogota npx tsx scripts/sombra/probar-corte-escalada.mts
 */
import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')
if (process.env.NODE_ENV !== 'development') (process.env as Record<string,string>).NODE_ENV='development'

const { supabaseAdmin } = await import('@/lib/supabase/admin')

// ── candado de escritura ────────────────────────────────────────────────────
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

const { decidirCorteDeEscalada } = await import('@/lib/conversations/corte-por-escalada')
const { ESCALATION_LABEL, isKnownReason } = await import('@/lib/conversations/escalation-reasons')
const { runAppointmentAgent } = await import('@/agents/appointment-agent')
const { getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes, buildExistingPatient, resolveTratantesForClinic } = await import('@/lib/agent/agent-context')

type Any = Record<string, unknown>
const CLINIC = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'

// ════════════════════════════════════════════════════════════════════════════
// PARTE 1 — El padrón COMPLETO de escaladas: quién se destraba y quién no.
// ════════════════════════════════════════════════════════════════════════════
const { data: escaladas } = await supabaseAdmin
  .from('conversations')
  .select('id, context, escalated_at, triage_state, status')
  .eq('clinic_id', CLINIC).eq('status', 'escalated')

const filas: Array<{ id: string; motivo: string; humano: boolean; atiende: boolean; porque: string; bloq: boolean; horas: number | null }> = []
for (const c of (escaladas ?? []) as Any[]) {
  const { count } = await supabaseAdmin.from('messages')
    .select('id', { count: 'exact', head: true }).eq('conversation_id', c.id as string).eq('role', 'staff')
  const humano = (count ?? 0) > 0
  const razon = (c.context as Any | null)?.escalation_reason
  const d = decidirCorteDeEscalada({ status: 'escalated', escalationReason: razon, huboRespuestaHumana: humano })
  filas.push({
    id: c.id as string,
    motivo: isKnownReason(razon) ? razon : '(desconocido)',
    humano, atiende: d.atiende, porque: d.porque ?? '—', bloq: d.accionBloqueada,
    horas: c.escalated_at ? Math.round((Date.now() - new Date(c.escalated_at as string).getTime()) / 36e5) : null,
  })
}

console.log(`\n═══ PARTE 1 · las ${filas.length} conversaciones escaladas de Algia, hoy ═══\n`)
const grupos = new Map<string, { total: number; humano: number; atiende: number; bloq: number }>()
for (const f of filas) {
  const g = grupos.get(f.motivo) ?? { total: 0, humano: 0, atiende: 0, bloq: 0 }
  g.total++; if (f.humano) g.humano++; if (f.atiende) g.atiende++; if (f.bloq && f.atiende) g.bloq++
  grupos.set(f.motivo, g)
}
console.log('motivo                          total  con humano  → el agente ATIENDE   sin poder agendar')
console.log('─'.repeat(92))
for (const [m, g] of [...grupos].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`${m.padEnd(30)}  ${String(g.total).padStart(5)}  ${String(g.humano).padStart(10)}  ${String(g.atiende).padStart(19)}  ${g.bloq ? String(g.bloq).padStart(17) : ''.padStart(17)}`)
}
const atiende = filas.filter((f) => f.atiende)
const callaHumano = filas.filter((f) => !f.atiende && f.porque === 'humano_ya_respondio')
const callaMotivo = filas.filter((f) => !f.atiende && f.porque === 'motivo_reservado_a_humano')
console.log('─'.repeat(92))
console.log(`TOTAL ${filas.length}   ·   destrabadas: ${atiende.length}   ·   calladas por humano adentro: ${callaHumano.length}   ·   calladas por motivo: ${callaMotivo.length}`)
const esperaMax = Math.max(...atiende.map((f) => f.horas ?? 0))
console.log(`\nDe las ${atiende.length} destrabadas, la que más lleva esperando sin que nadie escriba: ${esperaMax} horas (${Math.round(esperaMax / 24)} días).`)

// ════════════════════════════════════════════════════════════════════════════
// PARTE 2 — Tres simulaciones contra el agente REAL.
// ════════════════════════════════════════════════════════════════════════════
async function contexto(convId: string, hasta?: string) {
  const { data: conv } = await supabaseAdmin.from('conversations').select('id, clinic_id, context, patients(*)').eq('id', convId).single()
  const patient = (conv as Any).patients as Any
  const { data: clinicRow } = await supabaseAdmin.from('clinics').select('*').eq('id', (conv as Any).clinic_id as string).single()
  const clinic = clinicRow as Any
  const waConfig = getWhatsAppConfig(clinic as never) as unknown as Any
  const doctors = await findActiveDoctors(clinic.id as string, waConfig as never) as unknown as Any[]
  const consultationTypes = await findActiveConsultationTypes(clinic.id as string) as unknown as Any[]
  const { tratanteMode, tratantes } = await resolveTratantesForClinic(clinic as never, patient as never, convId)
  // Historial COMO ERA en ese momento: si se pasa `hasta`, se corta ahí. Sin
  // eso, la simulación de un caso viejo vería mensajes del futuro.
  const q = supabaseAdmin.from('messages').select('*').eq('conversation_id', convId)
  const { data: msgs } = await (hasta ? q.lt('created_at', hasta) : q)
    .order('created_at', { ascending: false }).limit(20)
  const messageHistory = ((msgs ?? []) as Any[]).reverse()
  return { conv, patient, clinic, waConfig, doctors, consultationTypes, tratanteMode, tratantes, messageHistory }
}

async function correrAgente(convId: string, texto: string, hasta?: string) {
  const c = await contexto(convId, hasta)
  const r = await runAppointmentAgent({
    patientMessage: texto,
    messageHistory: c.messageHistory as never,
    clinic: c.clinic as never, doctor: (c.doctors[0] ?? null) as never, doctors: c.doctors as never,
    waConfig: c.waConfig as never, consultationTypes: c.consultationTypes as never,
    patientPhone: (c.patient.phone as string) ?? '', patientName: (c.patient.name as string) ?? null,
    patientId: c.patient.id as string, existingPatient: buildExistingPatient(c.patient as never) as never,
    tratanteMode: c.tratanteMode as never, tratantes: c.tratantes as never, pinMedico: null,
    patientGender: (c.patient.gender as string) ?? null,
  } as never) as unknown as Any
  return r
}

const casos = process.argv.slice(2)
for (const spec of casos) {
  const [convId, etiqueta, hasta, ...resto] = spec.split('||')
  const texto = resto.join('||')
  const { data: conv } = await supabaseAdmin.from('conversations').select('id, context, status, triage_state, patients(name)').eq('id', convId).single()
  const razon = ((conv as Any)?.context as Any | null)?.escalation_reason
  const { count } = await supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', convId).eq('role', 'staff')
  const humano = (count ?? 0) > 0
  const d = decidirCorteDeEscalada({ status: 'escalated', escalationReason: razon, huboRespuestaHumana: humano })

  console.log(`\n\n════════════════════════════════════════════════════════════════`)
  console.log(`CASO · ${etiqueta}`)
  console.log(`════════════════════════════════════════════════════════════════`)
  console.log(`  motivo de escalación : ${isKnownReason(razon) ? `${razon} — ${ESCALATION_LABEL[razon]}` : '(desconocido)'}`)
  console.log(`  mensajes role=staff  : ${count ?? 0}`)
  console.log(`  DECISIÓN             : ${d.atiende ? '🟢 EL AGENTE ATIENDE' : `🔇 EL AGENTE SE CALLA (${d.porque})`}`)
  console.log(`  acción bloqueada     : ${d.accionBloqueada ? 'sí — el executor no lo deja agendar ese servicio' : 'no'}`)
  console.log(`  sigue en la bandeja  : status='escalated' (el corte no lo toca) · triage_state='atencion'`)

  if (!d.atiende) { console.log(`\n  → no se corre el agente: hoy y con el cambio, esta conversación no recibe respuesta del bot.`); continue }
  if (!texto) continue

  console.log(`\n  ── mensaje de la paciente (real, del caso) ──`)
  console.log(`  "${texto}"`)
  const t0 = Date.now()
  const r = await correrAgente(convId, texto, hasta || undefined)
  console.log(`\n  ── lo que HOY recibe: nada (32 h de silencio en el caso original) ──`)
  console.log(`  ── lo que recibiría CON EL CAMBIO (${Math.round((Date.now() - t0) / 1000)}s) ──\n`)
  console.log((r.text as string).split('\n').map((l) => '  │ ' + l).join('\n'))
  console.log(`\n  tools llamadas : [${(r.toolsUsed as string[]).join(', ')}]`)
  const errores = ((r.toolCalls ?? []) as Any[]).map((tc) => (tc.result as Any)?.error).filter(Boolean)
  if (errores.length) console.log(`  ⛔ bloqueos del executor: ${errores.join(' · ')}`)
  console.log(`  cita creada    : ${r.appointmentData ? '🔴 SÍ' : 'no'}`)
}

// ════════════════════════════════════════════════════════════════════════════
// PARTE 3 — El servicio ruleado, con la conversación DESTRABADA.
//
// Dos capas, y las dos tienen que seguir en pie:
//   A) Capa 0 corta ANTES del LLM si la paciente nombra el servicio.
//   B) el executor bloquea create_appointment aunque el modelo lo intente.
// El destrabe del corte no toca ninguna de las dos — se verifica, no se asume.
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n\n═══ PARTE 3 · servicio ruleado con la conversación destrabada ═══\n`)

const { detectEscalateService } = await import('@/lib/safety/escalate-service-matcher')
for (const frase of ['Quiero agendar una colposcopia para el jueves', 'Necesito el mapeo pélvico', 'Buenos días, quiero saber el horario de atención']) {
  const r = detectEscalateService(frase)
  console.log(`  Capa 0 · "${frase}" → ${r.matched ? `🛑 CORTA (${r.key})` : 'sigue al agente'}`)
}

// Backstop del executor: create_appointment sobre un tipo ruleado.
const { executeTool } = await import('@/agents/tools/executor')
const RULEADO = process.env.TIPO_RULEADO ?? ''
if (RULEADO) {
  const { data: ct } = await supabaseAdmin.from('consultation_types').select('id, name, doctor_id').eq('id', RULEADO).single()
  const { data: cl } = await supabaseAdmin.from('clinics').select('*').eq('id', CLINIC).single()
  const { data: doc } = await supabaseAdmin.from('doctors').select('*').eq('id', (ct as Any).doctor_id as string).single()
  console.log(`\n  Executor · create_appointment sobre "${(ct as Any).name}" (tipo ruleado):`)
  const res = await executeTool('create_appointment', {
    doctor_id: (ct as Any).doctor_id, consultation_type_id: (ct as Any).id,
    patient_name: 'PRUEBA SOMBRA', patient_phone: '+573000000000',
    date: '2026-09-15', time: '09:00', payment_type: 'particular',
  }, CLINIC, cl as never, doc as never, null, null) as unknown as Any
  console.log(`    success : ${res.success}`)
  console.log(`    error   : ${res.error}`)
  console.log(`    ${res.success ? '🔴 SE CREÓ — el backstop NO bloqueó' : '✅ BLOQUEADO por el backstop del executor'}`)
}

console.log(`\n\nescrituras bloqueadas por el candado: ${bloqueadas}\n`)
