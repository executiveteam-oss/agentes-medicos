/**
 * PRUEBA EN SOMBRA del contrato de salida del agente.
 *
 * QUÉ COMPARA
 *   Por cada turno real de la última semana, corre el loop del agente y arma la
 *   respuesta DOS veces sobre las MISMAS vueltas:
 *     · CONTRATO VIEJO — collectedTexts.join('\n\n') (lo de appointment-agent hoy)
 *     · CONTRATO NUEVO — armarSalida() de src/lib/agent/contrato-de-salida.ts
 *   Los dos pasan por la misma limpieza del webhook (markdown + monólogo +
 *   timestamps), así que la diferencia que quede es del contrato y de nada más.
 *
 * POR QUÉ HAY QUE RE-CORRER EL MODELO
 *   La decisión del contrato depende de EN QUÉ VUELTA del loop se emitió cada
 *   bloque de texto, y eso no se guarda en ningún lado: en `messages` sólo queda
 *   el texto ya unido. Partirlo por líneas en blanco no sirve — un solo bloque
 *   del modelo puede tener líneas en blanco adentro. Así que el harness re-corre
 *   y registra las vueltas.
 *
 *   ⚠️ Consecuencia honesta: el texto que produce el replay NO es idéntico al que
 *   salió en producción (el modelo no es determinista y la agenda de hoy no es la
 *   de entonces). Por eso el diff VIEJO-vs-NUEVO se mide dentro del replay, donde
 *   las dos ramas comparten exactamente las mismas vueltas. Lo que sí salió de
 *   verdad se guarda al lado, como control de parecido.
 *
 * 🚨 READ-ONLY, con dos candados independientes:
 *   1) Las 5 tools que escriben (create/cancel/reschedule/add_to_waitlist/
 *      escalate_to_human) NUNCA llegan al executor: se responden con un stub.
 *   2) Candado duro sobre supabaseAdmin: insert/update/delete/upsert/rpc quedan
 *      neutralizados para TODO el proceso. Aunque el stub fallara, no hay
 *      escritura posible — ni la fila de audit_log que checkAvailability mete
 *      por instrumentación.
 *   No manda WhatsApp: el harness no toca el webhook.
 *
 * Run: TZ=America/Bogota npx tsx scripts/sombra/replay-contrato-salida.ts [--dias 7] [--limite N] [--conc 6]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

function cargarEnv(p: string) {
  if (!existsSync(p)) return
  for (const l of readFileSync(p, 'utf-8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const e = t.indexOf('='); if (e < 0) continue
    const k = t.slice(0, e).trim(); let v = t.slice(e + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
cargarEnv('.env.production.local'); cargarEnv('.env.local')
if (process.env.NODE_ENV !== 'development') (process.env as Record<string, string>).NODE_ENV = 'development'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const arg = (n: string, d: number) => {
  const i = process.argv.indexOf(n)
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d
}
const DIAS = arg('--dias', 7)
const LIMITE = arg('--limite', 0)
const CONC = arg('--conc', 6)

// ── Imports dinámicos: el cliente de Supabase y el de Anthropic se construyen
//    al importarse leyendo process.env, así que el env tiene que estar cargado.
const { supabaseAdmin } = await import('@/lib/supabase/admin')

// ────────────────────────────────────────────────────────────
// CANDADO DURO — ninguna escritura sale de este proceso.
// ────────────────────────────────────────────────────────────
let intentosDeEscritura = 0
{
  type Q = Record<string, unknown>
  const noop = (): Q => {
    const stub: Q = {}
    const self = () => stub
    for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'is', 'not', 'or',
                     'order', 'limit', 'range', 'match', 'filter', 'single', 'maybeSingle', 'csv']) stub[m] = self
    stub.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res)
    return stub
  }
  const cliente = supabaseAdmin as unknown as { from: (t: string) => Q; rpc: (...a: unknown[]) => unknown }
  const fromOriginal = cliente.from.bind(cliente)
  cliente.from = (tabla: string) => {
    const qb = fromOriginal(tabla)
    for (const m of ['insert', 'update', 'delete', 'upsert']) {
      qb[m] = () => { intentosDeEscritura++; return noop() }
    }
    return qb
  }
  cliente.rpc = () => { intentosDeEscritura++; return noop() }
}

const { runAppointmentAgent: _no } = { runAppointmentAgent: null }  // no se usa: el loop se replica acá
void _no

const { anthropic, CLAUDE_CONFIG } = await import('@/lib/anthropic/client')
const { agentTools } = await import('@/lib/anthropic/tools')
const { buildSystemPrompt, PROMPT_CACHE_SPLIT_ANCHOR } = await import('@/agents/prompts/system-prompt')
const { executeTool } = await import('@/agents/tools/executor')
const { armarSalida } = await import('@/lib/agent/contrato-de-salida')
const { stripInternalMonologue } = await import('@/lib/whatsapp/strip-internal-monologue')
const { stripTimestampMarkers } = await import('@/lib/whatsapp/strip-timestamp-markers')
const { formatTimestampColombia } = await import('@/lib/utils/dates')
const { isHardBookingFailure, isTechnicalError, isUnknownConvenio, isClinicaNoOperativa } = await import('@/agents/booking-failure')
const { getWhatsAppConfig, findActiveDoctors, findActiveConsultationTypes, buildExistingPatient, resolveTratantesForClinic } = await import('@/lib/agent/agent-context')
const { detectarMencionDeMedico, leerPin } = await import('@/lib/agent/doctor-pin')
const { sanitizePatientMessage } = await import('@/lib/whatsapp/sanitize')

type Any = Record<string, unknown>
const MAX_ITER = 5
const FALLBACK_END = 'Lo siento, tuve un problema. Escribe "hablar con humano" para asistencia.'
const FALLBACK_RARO = 'Disculpa, tuve un problema técnico. Intenta de nuevo o escribe "hablar con humano".'
const FALLBACK_AGOTADO = 'Disculpa, estoy teniendo dificultades. Escribe "hablar con humano" y alguien del consultorio te ayudará.'

// ────────────────────────────────────────────────────────────
// STUBS de las tools que escriben. Forma fiel a la real (ver executor.ts).
// ────────────────────────────────────────────────────────────
const TOOLS_QUE_ESCRIBEN = new Set([
  'create_appointment', 'cancel_appointment', 'reschedule_appointment',
  'add_to_waitlist', 'escalate_to_human',
])
function stubDeEscritura(tool: string, input: Any): { success: boolean; data?: unknown; error?: string } {
  switch (tool) {
    case 'escalate_to_human':
      return { success: true, data: { escalated: true, urgency: input.urgency,
        message: input.urgency === 'emergency'
          ? 'Escalado como EMERGENCIA. Informar al paciente que alguien lo contactará pronto.'
          : 'Escalado al equipo. Informar al paciente que alguien del consultorio lo contactará pronto.' } }
    case 'add_to_waitlist':
      return { success: true, data: { added: true, message: 'Paciente agregado a la lista de espera.' } }
    case 'create_appointment':
    case 'reschedule_appointment':
    case 'cancel_appointment':
      // Sin appointmentData a propósito: no queremos que el harness crea que
      // hubo cita real (dispararía el .ics en el código de producción).
      return { success: true, data: { simulado: true,
        message: 'OK (simulado en sombra). Confirmar al paciente en lenguaje natural.' } }
    default:
      return { success: true, data: {} }
  }
}

// ────────────────────────────────────────────────────────────
// EL LOOP, replicado de appointment-agent.ts con una sola adición:
// registra las VUELTAS (textos + cierre + tools). Todo lo demás —el corte por
// escalate, los cortes deterministas, los fallbacks— es igual.
// ────────────────────────────────────────────────────────────
interface Vuelta { textos: string[]; cierre: 'end_turn' | 'tool_use' | 'otro'; tools: string[] }
interface Corrida {
  vueltas: Vuelta[]
  /** Cómo terminó el turno. 'determinista' = el loop devolvió texto propio. */
  cierre: 'end_turn' | 'raro' | 'agotado' | 'determinista'
  textoDeterminista?: string
  toolsUsadas: string[]
  error?: string
}

async function correrEnSombra(p: {
  patientMessage: string; messageHistory: Any[]; clinic: Any; doctor: Any; doctors: Any[]
  waConfig: Any; consultationTypes: Any[]; patientPhone: string; patientName: string
  patientId: string | null; existingPatient: Any | null; tratanteMode: string; tratantes: unknown[]
  pinMedico: Any | null
  reglas: { escalateHumanByCt: Set<string>; ageLimitsByCt: Map<string, unknown>; patientConditionsByCt: Map<string, unknown>; authConveniosByCt: Map<string, unknown> }
}): Promise<Corrida> {
  const vueltas: Vuelta[] = []
  const toolsUsadas: string[] = []

  const systemPrompt = buildSystemPrompt({
    clinic: p.clinic as never, doctor: p.doctor as never, doctors: p.doctors as never,
    waConfig: p.waConfig as never, consultationTypes: p.consultationTypes as never,
    patientPhone: p.patientPhone, patientName: p.patientName,
    existingPatient: p.existingPatient as never, tratanteMode: p.tratanteMode as never,
    tratantes: p.tratantes as never,
    escalateHumanByCt: p.reglas.escalateHumanByCt as never,
    ageLimitsByCt: p.reglas.ageLimitsByCt as never,
    patientConditionsByCt: p.reglas.patientConditionsByCt as never,
    authConveniosByCt: p.reglas.authConveniosByCt as never,
  })
  const splitIdx = systemPrompt.indexOf(PROMPT_CACHE_SPLIT_ANCHOR)
  const systemBlocks = splitIdx > 0
    ? [{ type: 'text' as const, text: systemPrompt.slice(0, splitIdx), cache_control: { type: 'ephemeral' as const } },
       { type: 'text' as const, text: systemPrompt.slice(splitIdx) }]
    : [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }]
  const cachedTools = agentTools.map((t, i) =>
    i === agentTools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t)

  // Historial, idéntico a buildMessageHistory
  const messages: Any[] = []
  for (const msg of p.messageHistory.slice(-20)) {
    const role = (msg.role as string) === 'patient' ? 'user' : 'assistant'
    const ts = formatTimestampColombia(msg.created_at as string)
    const line = ts ? `[${ts}] ${msg.content}` : (msg.content as string)
    const last = messages[messages.length - 1]
    if (last && last.role === role && typeof last.content === 'string') last.content += '\n' + line
    else messages.push({ role, content: line })
  }
  if (messages.length > 0 && messages[0].role === 'assistant') messages.shift()
  messages.push({ role: 'user', content: p.patientMessage })

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let response: Any
    try {
      response = await anthropic.messages.create({
        model: CLAUDE_CONFIG.model, max_tokens: CLAUDE_CONFIG.maxTokens,
        thinking: { type: 'disabled' }, system: systemBlocks as never,
        tools: cachedTools as never, messages: messages as never,
      }) as unknown as Any
    } catch (e) {
      return { vueltas, cierre: 'raro', toolsUsadas, error: e instanceof Error ? e.message : String(e) }
    }

    const contenido = response.content as Any[]
    const textos = contenido.filter((b) => b.type === 'text' && String(b.text).trim())
      .map((b) => String(b.text).trim())
    const usos = contenido.filter((b) => b.type === 'tool_use')
    const stop = response.stop_reason as string

    if (stop === 'end_turn') {
      vueltas.push({ textos, cierre: 'end_turn', tools: [] })
      return { vueltas, cierre: 'end_turn', toolsUsadas }
    }

    if (stop === 'tool_use') {
      vueltas.push({ textos, cierre: 'tool_use', tools: usos.map((u) => String(u.name)) })
      messages.push({ role: 'assistant', content: contenido })
      const toolResults: Any[] = []
      for (const u of usos) {
        const nombre = String(u.name)
        toolsUsadas.push(nombre)
        const input = u.input as Any
        const result = TOOLS_QUE_ESCRIBEN.has(nombre)
          ? stubDeEscritura(nombre, input)
          : await executeTool(nombre, input, p.clinic.id as string, p.clinic as never, p.doctor as never,
                              p.pinMedico as never, p.patientId)

        const ro = result as unknown as Any
        const rd = ro?.data as Any | undefined
        // Cortes deterministas del loop — idénticos a appointment-agent.
        if (ro?.success === false && isClinicaNoOperativa(ro.error as string)) {
          return { vueltas, cierre: 'determinista', toolsUsadas,
            textoDeterminista: (rd?.message_for_patient as string)
              || 'En este momento el consultorio no está atendiendo con normalidad. Ya le avisé al equipo para que se comunique contigo. 🙏' }
        }
        if (ro?.success === false && String(ro.error ?? '').startsWith('BLOCKED_BY_DOCTOR_PIN_SERVICE')) {
          const quien = (rd?.pinned_doctor_name as string) ?? 'ese médico'
          return { vueltas, cierre: 'determinista', toolsUsadas,
            textoDeterminista: `Ese servicio no lo atiende ${quien}. …` }
        }
        if (ro?.success === false && isUnknownConvenio(ro.error as string)) {
          return { vueltas, cierre: 'determinista', toolsUsadas,
            textoDeterminista: 'No tengo registrado ese convenio, pero eso no quiere decir que no exista 🙂 …' }
        }
        const bookingFail = ro?.success === false && isHardBookingFailure(nombre, ro.error as string)
        const techFail = ro?.success === false && isTechnicalError(ro.error as string)
        if (bookingFail || techFail) {
          return { vueltas, cierre: 'determinista', toolsUsadas,
            textoDeterminista: bookingFail
              ? 'Uy, tuve un inconveniente para agendar tu cita 🙁 …'
              : 'Uy, tuve un inconveniente técnico revisando eso 🙁 …' }
        }
        toolResults.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(result) })
      }
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    vueltas.push({ textos, cierre: 'otro', tools: [] })
    return { vueltas, cierre: 'raro', toolsUsadas }
  }
  return { vueltas, cierre: 'agotado', toolsUsadas }
}

// ── Las dos ramas del contrato, sobre las MISMAS vueltas ────────────────
function salidaVieja(c: Corrida): { text: string; bloques: string[] } {
  if (c.cierre === 'determinista') return { text: c.textoDeterminista ?? '', bloques: [] }
  if (c.cierre === 'agotado') return { text: FALLBACK_AGOTADO, bloques: [] }
  // collectedTexts: todo, con el corte por escalate_to_human
  const bloques: string[] = []
  let escaló = false
  for (const v of c.vueltas) {
    if (!escaló) bloques.push(...v.textos)
    if (v.tools.includes('escalate_to_human')) escaló = true
  }
  const fb = c.cierre === 'end_turn' ? FALLBACK_END : FALLBACK_RARO
  return { text: bloques.length ? bloques.join('\n\n') : fb, bloques }
}
function salidaNueva(c: Corrida) {
  if (c.cierre === 'determinista') return { text: c.textoDeterminista ?? '', bloques: [] as string[], origen: 'determinista', descartados: [] as string[] }
  if (c.cierre === 'agotado') return { text: FALLBACK_AGOTADO, bloques: [] as string[], origen: 'agotado', descartados: [] as string[] }
  const fb = c.cierre === 'end_turn' ? FALLBACK_END : FALLBACK_RARO
  const s = armarSalida(c.vueltas, fb)
  return { text: s.text, bloques: s.usados, origen: s.origen, descartados: s.descartadosTexto }
}

// Misma limpieza que el webhook, para las dos ramas.
function limpiarComoElWebhook(t: string): string {
  const cleanText = t
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/_(.*?)_/g, '$1')
    .replace(/^[•●]\s*/gm, '- ').replace(/^#{1,3}\s*/gm, '').replace(/`(.*?)`/g, '$1')
  return stripTimestampMarkers(stripInternalMonologue(cleanText).text).text
}

// ────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────
const t0 = Date.now()
console.log(`\n═══ SOMBRA — contrato de salida · últimos ${DIAS} días · modelo ${CLAUDE_CONFIG.model} ═══\n`)

const { data: clinicRow } = await supabaseAdmin.from('clinics').select('*').eq('id', ALGIA).single()
const clinic = clinicRow as Any
const waConfig = getWhatsAppConfig(clinic as never) as unknown as Any
const doctors = await findActiveDoctors(ALGIA, waConfig as never) as unknown as Any[]
const consultationTypes = await findActiveConsultationTypes(ALGIA) as unknown as Any[]

// Reglas por tipo de consulta — mismas queries que appointment-agent.
const ctIds = consultationTypes.map((c) => c.id as string)
const reglas = await (async () => {
  const escalateHumanByCt = new Set<string>()
  const ageLimitsByCt = new Map<string, unknown>()
  const patientConditionsByCt = new Map<string, unknown>()
  const authConveniosByCt = new Map<string, unknown>()
  const { data } = await supabaseAdmin.from('consultation_type_rules')
    .select('consultation_type_id, rule_type, condition_config').eq('active', true).in('consultation_type_id', ctIds)
  const { AgeLimitConfigSchema } = await import('@/lib/rules/age-limit-config')
  const { AuthConvenioConfigSchema } = await import('@/lib/rules/auth-convenio-config')
  const { getActivePatientConditionRulesForCts } = await import('@/app/actions/consultation-type-rules')
  for (const r of (data ?? []) as Any[]) {
    const id = r.consultation_type_id as string
    if (r.rule_type === 'escalate_human') escalateHumanByCt.add(id)
    if (r.rule_type === 'age_limit') { const p = AgeLimitConfigSchema.safeParse(r.condition_config); if (p.success) ageLimitsByCt.set(id, p.data) }
    if (r.rule_type === 'requires_authorization') { const p = AuthConvenioConfigSchema.safeParse(r.condition_config); if (p.success) authConveniosByCt.set(id, { convenios_que_requieren: p.data.convenios_que_requieren, message_pedir_archivo: p.data.message_pedir_archivo }) }
  }
  try {
    const rules = await getActivePatientConditionRulesForCts(ctIds)
    for (const r of rules as Any[]) {
      const cfg = r.config as Any
      const lista = (patientConditionsByCt.get(r.consultation_type_id as string) as unknown[]) ?? []
      lista.push(cfg.question_type === 'yes_no'
        ? { rule_id: r.id, question_type: 'yes_no', question: cfg.question, trigger_answer: cfg.trigger_answer, action_on_trigger: cfg.action_on_trigger }
        : { rule_id: r.id, question_type: 'multiple_choice', question: cfg.question, options: (cfg.options as Any[]).map((o) => ({ id: o.id, label: o.label, action_if_chosen: o.action_if_chosen })) })
      patientConditionsByCt.set(r.consultation_type_id as string, lista)
    }
  } catch { /* sin reglas de condición */ }
  return { escalateHumanByCt, ageLimitsByCt, patientConditionsByCt, authConveniosByCt }
})()

console.log(`clinic=${clinic.name}  médicos=${doctors.length}  tipos=${consultationTypes.length}  reglas: escalate=${reglas.escalateHumanByCt.size} edad=${reglas.ageLimitsByCt.size} condición=${reglas.patientConditionsByCt.size} auth=${reglas.authConveniosByCt.size}`)

// ── Turnos reales: mensaje de paciente seguido de mensaje del agente ──
const desde = new Date(Date.now() - DIAS * 864e5).toISOString()
const { data: convs } = await supabaseAdmin.from('conversations')
  .select('id, context, patients(*)').eq('clinic_id', ALGIA).gte('last_message_at', desde).limit(500)

interface Turno {
  convId: string; patient: Any; patientMsg: Any; agentMsg: Any; historia: Any[]
}
const turnos: Turno[] = []
for (const c of (convs ?? []) as Any[]) {
  const { data: msgs } = await supabaseAdmin.from('messages')
    .select('id, role, content, created_at').eq('conversation_id', c.id as string)
    .order('created_at', { ascending: true }).limit(2000)
  const lista = (msgs ?? []) as Any[]
  for (let i = 0; i < lista.length - 1; i++) {
    const m = lista[i], n = lista[i + 1]
    if (m.role !== 'patient' || n.role !== 'agent') continue
    if (new Date(m.created_at as string).getTime() < Date.parse(desde)) continue
    if (!c.patients) continue
    turnos.push({ convId: c.id as string, patient: c.patients as Any, patientMsg: m, agentMsg: n, historia: lista.slice(0, i) })
  }
}
turnos.sort((a, b) => String(a.patientMsg.created_at).localeCompare(String(b.patientMsg.created_at)))
const seleccion = LIMITE > 0 ? turnos.slice(-LIMITE) : turnos
console.log(`turnos paciente→agente en la ventana: ${turnos.length}  ·  a correr: ${seleccion.length}  ·  concurrencia: ${CONC}\n`)

interface Fila {
  i: number; convId: string; fecha: string
  patientMsg: string; real: string
  viejo: string; nuevo: string; origen: string
  perdidos: string[]; agregados: string[]
  cierre: string; tools: string[]; vueltas: number; bloquesTotales: number
  detalleVueltas: Array<{ textos: string[]; cierre: string; tools: string[] }>
  clase: 'IGUAL' | 'DESAPARECE' | 'CAMBIA' | 'SILENCIO' | 'ERROR'
  error?: string
}
const filas: Fila[] = []
let hechos = 0

async function procesar(t: Turno, i: number): Promise<Fila> {
  const base: Fila = {
    i, convId: t.convId, fecha: String(t.patientMsg.created_at),
    patientMsg: String(t.patientMsg.content), real: String(t.agentMsg.content),
    viejo: '', nuevo: '', origen: '', perdidos: [], agregados: [],
    cierre: '', tools: [], vueltas: 0, bloquesTotales: 0, detalleVueltas: [], clase: 'ERROR',
  }
  try {
    const sanitized = sanitizePatientMessage(String(t.patientMsg.content))
    const pin = leerPin(t.patient.context as never)
      ?? detectarMencionDeMedico(sanitized, doctors as never, { nombrePaciente: t.patient.name as string })
    const existingPatient = buildExistingPatient(t.patient as never) as unknown as Any
    const { tratanteMode, tratantes } = await resolveTratantesForClinic(clinic as never, t.patient as never, t.convId)

    const c = await correrEnSombra({
      patientMessage: sanitized, messageHistory: t.historia, clinic, doctor: doctors[0], doctors,
      waConfig, consultationTypes, patientPhone: t.patient.phone as string, patientName: t.patient.name as string,
      patientId: t.patient.id as string, existingPatient, tratanteMode, tratantes, pinMedico: pin as never, reglas,
    })
    if (c.error) { base.error = c.error; return base }

    const v = salidaVieja(c), n = salidaNueva(c)
    const viejo = limpiarComoElWebhook(v.text)
    const nuevo = limpiarComoElWebhook(n.text)
    const setN = new Set(n.bloques.map((b) => b.trim()))
    const setV = new Set(v.bloques.map((b) => b.trim()))
    base.viejo = viejo; base.nuevo = nuevo; base.origen = n.origen
    base.perdidos = v.bloques.map((b) => b.trim()).filter((b) => !setN.has(b))
    base.agregados = n.bloques.map((b) => b.trim()).filter((b) => !setV.has(b))
    base.cierre = c.cierre; base.tools = c.toolsUsadas; base.vueltas = c.vueltas.length
    base.detalleVueltas = c.vueltas
    base.bloquesTotales = c.vueltas.reduce((a, x) => a + x.textos.length, 0)
    base.clase = !nuevo.trim() ? 'SILENCIO'
      : viejo.trim() === nuevo.trim() ? 'IGUAL'
      : base.agregados.length === 0 && base.perdidos.length > 0 ? 'DESAPARECE'
      : 'CAMBIA'
    return base
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e)
    return base
  }
}

// Pool de concurrencia simple, con corte duro por tiempo.
const LIMITE_MS = 55 * 60 * 1000
let idx = 0
async function worker() {
  for (;;) {
    const i = idx++
    if (i >= seleccion.length) return
    if (Date.now() - t0 > LIMITE_MS) { console.warn('⏱ corte por timeout duro'); return }
    filas.push(await procesar(seleccion[i], i))
    hechos++
    if (hechos % 25 === 0) process.stdout.write(`  ${hechos}/${seleccion.length} (${Math.round((Date.now() - t0) / 1000)}s)\n`)
  }
}
await Promise.all(Array.from({ length: CONC }, worker))

filas.sort((a, b) => a.i - b.i)
const cuenta = (c: string) => filas.filter((f) => f.clase === c).length
console.log(`\n═══ RESULTADO — ${filas.length} turnos ═══`)
console.log(`  IGUAL       ${cuenta('IGUAL')}`)
console.log(`  DESAPARECE  ${cuenta('DESAPARECE')}`)
console.log(`  CAMBIA      ${cuenta('CAMBIA')}`)
console.log(`  SILENCIO    ${cuenta('SILENCIO')}   ← el peor caso`)
console.log(`  ERROR       ${cuenta('ERROR')}`)
console.log(`\n  intentos de escritura bloqueados por el candado: ${intentosDeEscritura}`)
console.log(`  duración: ${Math.round((Date.now() - t0) / 1000)}s`)

mkdirSync('scripts/sombra/salida', { recursive: true })
const out = `scripts/sombra/salida/diff-${DIAS}d.json`
writeFileSync(out, JSON.stringify({ generado: new Date().toISOString(), dias: DIAS, modelo: CLAUDE_CONFIG.model, turnos: filas }, null, 2))
console.log(`\n  detalle → ${out}\n`)
