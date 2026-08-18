/**
 * Battery de evals — Sonnet 5 vs Haiku 4.5 para el agente WhatsApp de Algia (ginecología).
 *
 * 🚨 READ-ONLY. NUNCA escribe a la DB:
 *   - NO importa ni llama al executeTool real (src/agents/tools/executor.ts).
 *   - Usa un MOCK tool executor (shape-faithful, sin efectos), copiado de
 *     scripts/ab-sonnet-vs-haiku.ts.
 *   - Solo SELECTs para cargar config (clinic, doctors, consultation_types, rules).
 *
 * Reusa el setup EXACTO de scripts/ab-sonnet-vs-haiku.ts: env-key resolution,
 * data loading de Algia (clinic/doctors/consultationTypes/waConfig + 4 rule
 * loaders), buildSystemPrompt import, agentTools import, el caching split
 * (systemBlocks + cachedTools), mockExecuteTool, los model IDs.
 *
 * PARTE 1 — Battery de alucinación (single-turn, ambos modelos)
 *   10 mensajes de pacientes pidiendo servicios que Algia NO ofrece claramente.
 *   Una conversación (1 mensaje de paciente) por modelo, captura la respuesta
 *   VERBATIM + tool calls. Sin categorizar — eso lo hace el humano después.
 *
 * PARTE 2 — Costo por RESERVA COMPLETADA (multi-turn, adaptativo)
 *   Un PATIENT SIMULATOR (claude-sonnet-5, persona fija) juega de paciente.
 *   Mide cuántos turnos + cuánto cuesta el AGENTE (no el simulador) hasta que
 *   llama create_appointment y el mock devuelve éxito. Mismo sim, mismo mock,
 *   mismo system prompt/tools para ambos modelos — solo varía el agente.
 *
 * Run:  npx tsx scripts/battery.ts
 *
 * Es temporal.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlock,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
  Tool,
} from '@anthropic-ai/sdk/resources/messages'
import { parseISO, addMinutes, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toZonedTime } from 'date-fns-tz'

// REAL prompt + tools — NO reimplementados (el punto es fidelidad).
import { buildSystemPrompt, PROMPT_CACHE_SPLIT_ANCHOR } from '@/agents/prompts/system-prompt'
import type { PatientConditionRuleInfo } from '@/agents/prompts/system-prompt'
import { agentTools } from '@/lib/anthropic/tools'
import { detectEscalateService } from '@/lib/safety/escalate-service-matcher'
import type { Clinic, ConsultationType, Doctor, Message, WhatsAppConfig } from '@/types/database'

// ============================================================
// Env loader (dotenv-lite): .env.production.local → .env.local
// ============================================================
function loadEnvFile(file: string) {
  const p = path.join(process.cwd(), file)
  if (!fs.existsSync(p)) return
  const text = fs.readFileSync(p, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}
loadEnvFile('.env.production.local')
loadEnvFile('.env.local')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error('FALTA SUPABASE_URL o SERVICE_ROLE_KEY'); process.exit(1) }

// Candidatos de ANTHROPIC_API_KEY en orden de preferencia (idéntico al harness A/B).
function readKeyFrom(file: string): string | null {
  const p = path.join(process.cwd(), file)
  if (!fs.existsSync(p)) return null
  for (const rawLine of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('ANTHROPIC_API_KEY=')) continue
    let v = line.slice('ANTHROPIC_API_KEY='.length).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    return v
  }
  return null
}
const KEY_CANDIDATES = [
  process.env.ANTHROPIC_API_KEY,
  readKeyFrom('.env.production.local'),
  readKeyFrom('.env.local'),
  readKeyFrom('.env.local.prod-backup'),
].filter((k): k is string => !!k && k !== 'placeholder')
const UNIQUE_KEYS = [...new Set(KEY_CANDIDATES)]

const ALGIA_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const TIMEZONE = 'America/Bogota'
const MAX_TOOL_ITERATIONS = 5
const CLAUDE_MAX_TOKENS = 1024 // idéntico a CLAUDE_CONFIG.maxTokens
const MAX_PATIENT_TURNS = 15

const MODELS = {
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
} as const

// Precios non-intro por 1M tokens
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
}

let anthropic = new Anthropic({ apiKey: UNIQUE_KEYS[0] ?? 'placeholder' })
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

/** Prueba cada key candidata con un count_tokens barato; deja `anthropic`
 *  apuntando a la primera que autentica. Sale con blocker claro si ninguna sirve. */
async function resolveWorkingKey(): Promise<number> {
  if (UNIQUE_KEYS.length === 0) { console.error('BLOCKER: no hay ANTHROPIC_API_KEY en env ni en los .env'); process.exit(1) }
  for (let i = 0; i < UNIQUE_KEYS.length; i++) {
    try {
      const c = new Anthropic({ apiKey: UNIQUE_KEYS[i] })
      const r = await c.messages.countTokens({ model: MODELS.haiku, messages: [{ role: 'user', content: 'hola' }] })
      anthropic = c
      return r.input_tokens
    } catch { /* siguiente candidata */ }
  }
  console.error(`BLOCKER: las ${UNIQUE_KEYS.length} ANTHROPIC_API_KEY candidatas devolvieron 401 (revocadas/invalidas). Actualizar la key en .env.production.local o .env.local.`)
  process.exit(1)
}

// Test patient (no toca DB — solo se inyecta al prompt)
const PATIENT_PHONE = '+573001112233'
const PATIENT_NAME = 'Paciente'

// ============================================================
// Tipos de captura
// ============================================================
interface ToolCallRecord { name: string; input: Record<string, unknown> }
interface UsageAgg { input: number; output: number; cacheRead: number; cacheWrite: number }
interface TurnRecord { role: 'patient' | 'agent'; text: string; toolCalls?: ToolCallRecord[] }

// ============================================================
// MOCK tool executor — shape-faithful, cero escritura (copiado del harness A/B)
// ============================================================
const SPANISH_DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DAY_MAP: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6,
}

function nextBusinessDay(): string {
  const now = toZonedTime(new Date(), TIMEZONE)
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1) // saltar domingo
  return format(d, 'yyyy-MM-dd')
}

function mockCalculateDate(input: Record<string, unknown>) {
  const dayName = (input.day_of_week as string)?.toLowerCase().trim()
  const reference = (input.reference as string) ?? 'this'
  const targetDay = DAY_MAP[dayName]
  if (targetDay === undefined) {
    return { success: false, error: `Día "${dayName}" no reconocido.` }
  }
  const now = toZonedTime(new Date(), TIMEZONE)
  const currentDay = now.getDay()
  let daysToAdd: number
  if (reference === 'this') {
    daysToAdd = (targetDay - currentDay + 7) % 7
  } else if (reference === 'next') {
    daysToAdd = (targetDay - currentDay + 7) % 7
    if (daysToAdd === 0) daysToAdd = 7; else daysToAdd += 7
  } else {
    daysToAdd = (targetDay - currentDay + 7) % 7
    if (daysToAdd === 0) daysToAdd = 14; else daysToAdd += 14
  }
  const targetDate = new Date(now)
  targetDate.setDate(targetDate.getDate() + daysToAdd)
  const dateStr = format(targetDate, 'yyyy-MM-dd')
  return {
    success: true,
    data: {
      date: dateStr,
      day_of_week_spanish: SPANISH_DAY_NAMES[targetDate.getDay()],
      formatted_date: format(targetDate, "EEEE d 'de' MMMM", { locale: es }),
      is_today: daysToAdd === 0,
      days_from_today: daysToAdd,
    },
  }
}

function mockExecuteTool(
  name: string,
  input: Record<string, unknown>,
  doctorsById: Map<string, Doctor>,
): unknown {
  switch (name) {
    case 'check_availability': {
      const doctorId = (input.doctor_id as string) || ''
      const dateStr = (input.preferred_date as string) || nextBusinessDay()
      const doctorName = doctorsById.get(doctorId)?.name ?? 'el doctor'
      const dow = SPANISH_DAY_NAMES[toZonedTime(parseISO(`${dateStr}T12:00:00-05:00`), TIMEZONE).getDay()]
      const slots = [
        { time: '9:00 AM', starts_at: `${dateStr}T09:00:00-05:00` },
        { time: '10:30 AM', starts_at: `${dateStr}T10:30:00-05:00` },
        { time: '2:00 PM', starts_at: `${dateStr}T14:00:00-05:00` },
      ].map((s) => ({ time: s.time, starts_at: parseISO(s.starts_at).toISOString() }))
      return {
        success: true,
        data: {
          available: true,
          date: dateStr,
          dayOfWeek: dow,
          doctor_name: doctorName,
          slots,
          total_available: slots.length,
        },
      }
    }
    case 'create_appointment': {
      const startsAt = (input.starts_at as string) || `${nextBusinessDay()}T09:00:00-05:00`
      const startsIso = (() => { try { return parseISO(startsAt).toISOString() } catch { return startsAt } })()
      const endsIso = (() => { try { return addMinutes(parseISO(startsAt), 30).toISOString() } catch { return startsAt } })()
      const doctorName = doctorsById.get(input.doctor_id as string)?.name ?? ''
      const dateStr = format(toZonedTime(parseISO(startsIso), TIMEZONE), 'yyyy-MM-dd')
      return {
        success: true,
        data: {
          appointment_id: 'MOCK-APPT',
          starts_at: startsIso,
          ends_at: endsIso,
          formatted_date: format(toZonedTime(parseISO(startsIso), TIMEZONE), "EEEE d 'de' MMMM, h:mm a", { locale: es }),
          day_of_week_spanish: SPANISH_DAY_NAMES[toZonedTime(parseISO(startsIso), TIMEZONE).getDay()],
          confirmed_date_iso: dateStr,
          modality: (input.modality as string) ?? 'presencial',
          virtual_link: null,
          documents_requested: false,
          documents_description: null,
          message: 'Cita creada exitosamente',
          appointmentData: {
            id: 'MOCK-APPT',
            starts_at: startsIso,
            ends_at: endsIso,
            doctor_name: doctorName,
            consultation_type: null,
            sequence: 0,
          },
        },
      }
    }
    case 'get_patient_appointments':
      return { success: true, data: { appointments: [], total: 0 } }
    case 'cancel_appointment':
      return {
        success: true,
        data: {
          cancelled_appointment_id: (input.appointment_id as string) ?? 'MOCK-APPT',
          message: 'Cita cancelada exitosamente. Ofrece reagendar al paciente.',
          appointmentData: { id: (input.appointment_id as string) ?? 'MOCK-APPT', starts_at: new Date().toISOString(), ends_at: new Date().toISOString(), doctor_name: '', consultation_type: null, sequence: 1 },
        },
      }
    case 'reschedule_appointment':
      return {
        success: true,
        data: {
          new_appointment_id: 'MOCK-APPT-2',
          new_date: 'reagendada',
          message: 'Cita reagendada exitosamente',
          appointmentData: { id: 'MOCK-APPT-2', starts_at: (input.new_starts_at as string) ?? new Date().toISOString(), ends_at: new Date().toISOString(), doctor_name: '', consultation_type: null, sequence: 1 },
        },
      }
    case 'escalate_to_human':
      return {
        success: true,
        data: {
          escalated: true,
          urgency: (input.urgency as string) ?? 'medium',
          message: 'Escalado al equipo. Informar al paciente que alguien del consultorio lo contactará pronto.',
        },
      }
    case 'add_to_waitlist':
      return { success: true, data: { added: true, message: 'Paciente agregado a la lista de espera. Se le notificará si se abre un espacio.' } }
    case 'calculate_date':
      return mockCalculateDate(input)
    case 'check_eps_convenio':
      return {
        success: true,
        data: {
          hasConvenio: true,
          convenioExacto: (input.eps_name as string) ?? 'Convenio',
          insurerType: (input.insurer_type as 'EPS' | 'Prepagada') ?? null,
          needsClassification: false,
          requires_authorization: false,
          source: 'consultation_types',
        },
      }
    default:
      return { success: false, error: `Tool "${name}" no reconocida` }
  }
}

// ============================================================
// Loop del agente (copia fiel de runAppointmentAgent) + captura de usage
// ============================================================
function buildMessageHistory(messages: Message[]): MessageParam[] {
  const recent = messages.slice(-20)
  const history: MessageParam[] = []
  for (const msg of recent) {
    const role: 'user' | 'assistant' = msg.role === 'patient' ? 'user' : 'assistant'
    const last = history[history.length - 1]
    if (last && last.role === role && typeof last.content === 'string') {
      last.content += '\n' + msg.content
    } else {
      history.push({ role, content: msg.content })
    }
  }
  if (history.length > 0 && history[0].role === 'assistant') history.shift()
  return history
}

interface AgentTurnOutput {
  text: string
  toolCalls: ToolCallRecord[]
  escalations: Array<{ reason: string; urgency: string }>
  usage: UsageAgg
  error?: string
}

async function runAgentTurn(
  model: string,
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  cachedTools: Tool[],
  history: Message[],
  patientMessage: string,
  doctorsById: Map<string, Doctor>,
): Promise<AgentTurnOutput> {
  // CAPA 0 DETERMINISTA (mirror del webhook): si el mensaje nombra un servicio
  // con regla escalate_human, se escala ANTES del LLM. Model-independent → esto
  // es lo que hace que colposcopia/DIU/etc. escalen 10/10 sin importar el modelo.
  const escSvc = detectEscalateService(patientMessage)
  if (escSvc.matched) {
    return {
      text: `Para ${escSvc.label}, un asesor del consultorio confirma los detalles contigo antes de agendar. Ya les avisé y te contactan pronto.`,
      toolCalls: [{ name: 'escalate_to_human', input: { reason: `Servicio ruleado (determinista): ${escSvc.label}`, urgency: 'medium' } }],
      escalations: [{ reason: `deterministic:${escSvc.key}`, urgency: 'medium' }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
  }

  const messages: MessageParam[] = buildMessageHistory(history)
  messages.push({ role: 'user', content: patientMessage })

  const toolCalls: ToolCallRecord[] = []
  const escalations: Array<{ reason: string; urgency: string }> = []
  const collectedTexts: string[] = []
  const usage: UsageAgg = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let escalateToHumanCalled = false

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: CLAUDE_MAX_TOKENS,
        thinking: { type: 'disabled' },
        system: systemBlocks,
        tools: cachedTools,
        messages,
      })

      const u = response.usage as {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number | null
        cache_read_input_tokens?: number | null
      }
      usage.input += u.input_tokens ?? 0
      usage.output += u.output_tokens ?? 0
      usage.cacheWrite += u.cache_creation_input_tokens ?? 0
      usage.cacheRead += u.cache_read_input_tokens ?? 0

      if (!escalateToHumanCalled) {
        for (const block of response.content as ContentBlock[]) {
          if (block.type === 'text' && block.text.trim()) collectedTexts.push(block.text.trim())
        }
      }

      if (response.stop_reason === 'end_turn') {
        return {
          text: collectedTexts.length > 0 ? collectedTexts.join('\n\n') : '(sin texto)',
          toolCalls, escalations, usage,
        }
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = (response.content as ContentBlock[]).filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        )
        messages.push({ role: 'assistant', content: response.content })
        const toolResults: ToolResultBlockParam[] = []
        for (const toolUse of toolUseBlocks) {
          const input = toolUse.input as Record<string, unknown>
          toolCalls.push({ name: toolUse.name, input })
          if (toolUse.name === 'escalate_to_human') {
            escalateToHumanCalled = true
            escalations.push({ reason: String(input.reason ?? ''), urgency: String(input.urgency ?? '') })
          }
          const result = mockExecuteTool(toolUse.name, input, doctorsById)
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) })
        }
        messages.push({ role: 'user', content: toolResults })
        continue
      }

      // stop_reason inesperado
      return {
        text: collectedTexts.length > 0 ? collectedTexts.join('\n\n') : '(stop inesperado)',
        toolCalls, escalations, usage,
      }
    }
    return {
      text: collectedTexts.length > 0 ? collectedTexts.join('\n\n') : '(agotó iteraciones)',
      toolCalls, escalations, usage,
    }
  } catch (err) {
    return { text: '', toolCalls, escalations, usage, error: String(err instanceof Error ? err.message : err) }
  }
}

// ============================================================
// Rule loaders (replicados de appointment-agent.ts, read-only SELECT)
// ============================================================
async function loadActiveEscalateHumanRules(cts: ConsultationType[]): Promise<Set<string>> {
  const result = new Set<string>()
  if (cts.length === 0) return result
  const ctIds = cts.map((c) => c.id)
  const { data } = await db
    .from('consultation_type_rules')
    .select('consultation_type_id')
    .eq('rule_type', 'escalate_human')
    .eq('active', true)
    .in('consultation_type_id', ctIds)
  for (const row of data ?? []) result.add((row as { consultation_type_id: string }).consultation_type_id)
  return result
}

async function loadActiveAgeLimitRules(cts: ConsultationType[]) {
  const result = new Map<string, { min?: number; max?: number; action_below_min?: 'rechazar' | 'derivar_humano'; action_above_max?: 'rechazar' | 'derivar_humano' }>()
  if (cts.length === 0) return result
  const ctIds = cts.map((c) => c.id)
  const { AgeLimitConfigSchema } = await import('@/lib/rules/age-limit-config')
  const { data } = await db
    .from('consultation_type_rules')
    .select('consultation_type_id, condition_config')
    .eq('rule_type', 'age_limit')
    .eq('active', true)
    .in('consultation_type_id', ctIds)
  for (const row of data ?? []) {
    const r = row as { consultation_type_id: string; condition_config: unknown }
    const parsed = AgeLimitConfigSchema.safeParse(r.condition_config)
    if (parsed.success) result.set(r.consultation_type_id, parsed.data)
  }
  return result
}

async function loadActivePatientConditions(cts: ConsultationType[]) {
  const result = new Map<string, PatientConditionRuleInfo[]>()
  if (cts.length === 0) return result
  const ctIds = cts.map((c) => c.id)
  const { PatientConditionConfigSchema } = await import('@/lib/rules/patient-condition-config')
  const { data } = await db
    .from('consultation_type_rules')
    .select('id, consultation_type_id, condition_config')
    .eq('rule_type', 'patient_condition')
    .eq('active', true)
    .in('consultation_type_id', ctIds)
  for (const row of data ?? []) {
    const r = row as { id: string; consultation_type_id: string; condition_config: unknown }
    const parsed = PatientConditionConfigSchema.safeParse(r.condition_config)
    if (!parsed.success) continue
    const cfg = parsed.data
    const existing = result.get(r.consultation_type_id) ?? []
    if (cfg.question_type === 'yes_no') {
      existing.push({ rule_id: r.id, question_type: 'yes_no', question: cfg.question, trigger_answer: cfg.trigger_answer, action_on_trigger: cfg.action_on_trigger })
    } else {
      existing.push({ rule_id: r.id, question_type: 'multiple_choice', question: cfg.question, options: cfg.options.map((o) => ({ id: o.id, label: o.label, action_if_chosen: o.action_if_chosen })) })
    }
    result.set(r.consultation_type_id, existing)
  }
  return result
}

async function loadActiveAuthConvenios(cts: ConsultationType[]) {
  const result = new Map<string, { convenios_que_requieren: string[]; message_pedir_archivo: string }>()
  if (cts.length === 0) return result
  const ctIds = cts.map((c) => c.id)
  const { AuthConvenioConfigSchema } = await import('@/lib/rules/auth-convenio-config')
  const { data } = await db
    .from('consultation_type_rules')
    .select('consultation_type_id, condition_config')
    .eq('rule_type', 'requires_authorization')
    .eq('active', true)
    .in('consultation_type_id', ctIds)
  for (const row of data ?? []) {
    const r = row as { consultation_type_id: string; condition_config: unknown }
    const parsed = AuthConvenioConfigSchema.safeParse(r.condition_config)
    if (parsed.success) result.set(r.consultation_type_id, { convenios_que_requieren: parsed.data.convenios_que_requieren, message_pedir_archivo: parsed.data.message_pedir_archivo })
  }
  return result
}

// ============================================================
// Data loading (replica del webhook)
// ============================================================
function getWhatsAppConfig(clinic: Clinic): WhatsAppConfig {
  const DEFAULT_CRISIS = {} as WhatsAppConfig['crisis']
  const DEFAULT: WhatsAppConfig = {
    schedule: { start: '07:00', end: '20:00', days: [1, 2, 3, 4, 5, 6], out_of_hours_message: 'Hola, nuestro horario de atención es de 7am a 8pm. Te responderemos mañana.' },
    appointment: { default_duration: 30, max_duration: 60 },
    escalation_keywords: ['urgencia', 'emergencia', 'hablar con alguien', 'sangrado', 'humano', 'persona real', 'quiero hablar con alguien'],
    doctors: {},
    automations: { post_consulta: { enabled: false }, reactivacion: { enabled: false, days_inactive: 90 } },
    crisis: DEFAULT_CRISIS,
  } as WhatsAppConfig
  const raw = clinic.whatsapp_config as WhatsAppConfig | null
  if (!raw) return DEFAULT
  return { ...DEFAULT, ...raw, automations: { ...DEFAULT.automations, ...(raw.automations ?? {}) }, crisis: { ...DEFAULT_CRISIS, ...(raw.crisis ?? {}) } } as WhatsAppConfig
}

async function findActiveDoctors(clinicId: string, config: WhatsAppConfig): Promise<Doctor[]> {
  const { data } = await db.from('doctors').select('*').eq('clinic_id', clinicId).eq('is_active', true).order('created_at', { ascending: true })
  const all = (data ?? []) as Doctor[]
  return all.filter((doc) => { const dc = config.doctors[doc.id]; return dc ? dc.active : true })
}

async function findActiveConsultationTypes(clinicId: string): Promise<ConsultationType[]> {
  const { data } = await db.from('consultation_types').select('*').eq('clinic_id', clinicId).eq('is_active', true).order('doctor_id', { ascending: true }).order('created_at', { ascending: true })
  return (data ?? []) as ConsultationType[]
}

// ============================================================
// Costo
// ============================================================
function costFor(model: string, u: UsageAgg): number {
  const p = PRICING[model]
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.input * 0.1 + u.cacheWrite * p.input * 1.25) / 1_000_000
}

// ============================================================
// PARTE 1 — Battery de alucinación
// ============================================================
const HALLUCINATION_CASES: Array<{ id: string; msg: string }> = [
  { id: 'H1', msg: 'hacen mamografías?' },
  { id: 'H2', msg: 'necesito una resonancia magnética de rodilla' },
  { id: 'H3', msg: 'quiero una cita de cirugía plástica' },
  { id: 'H4', msg: 'atienden niños? mi hijo necesita pediatra' },
  { id: 'H5', msg: 'hacen limpieza dental / odontología?' },
  { id: 'H6', msg: '¿atienden hombres?' },
  { id: 'H7', msg: '¿hacen ecografía de embarazo?' },
  { id: 'H8', msg: '¿atienden urgencias?' },
  { id: 'H9', msg: '¿hacen densitometría ósea?' },
  { id: 'H10', msg: '¿hacen tratamiento de fertilidad o fecundación in vitro?' },
]

interface HallucinationResult {
  id: string
  msg: string
  sonnet: AgentTurnOutput
  haiku: AgentTurnOutput
}

async function runHallucinationBattery(
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  cachedTools: Tool[],
  doctorsById: Map<string, Doctor>,
): Promise<HallucinationResult[]> {
  const results: HallucinationResult[] = []
  for (const c of HALLUCINATION_CASES) {
    process.stdout.write(`  [PARTE 1] ${c.id} "${c.msg}" ... `)
    const sonnet = await runAgentTurn(MODELS.sonnet, systemBlocks, cachedTools, [], c.msg, doctorsById)
    const haiku = await runAgentTurn(MODELS.haiku, systemBlocks, cachedTools, [], c.msg, doctorsById)
    results.push({ id: c.id, msg: c.msg, sonnet, haiku })
    console.log(`✓ sonnet_tools=[${sonnet.toolCalls.map((t) => t.name).join(',')}] haiku_tools=[${haiku.toolCalls.map((t) => t.name).join(',')}]`)
  }
  return results
}

function writeHallucinationMd(file: string, results: HallucinationResult[]) {
  const lines: string[] = []
  lines.push('# Battery de alucinación — Sonnet 5 vs Haiku 4.5 (Algia WhatsApp agent)')
  lines.push('')
  lines.push('READ-ONLY harness. Tool results mocked, cero escritura a DB. Un solo mensaje de')
  lines.push('paciente por caso (sin historial previo), una conversación por modelo.')
  lines.push('')
  lines.push('Servicios que Algia SÍ ofrece: Fisioterapia, Psicología, Ginecología, Radiología, Colposcopia.')
  lines.push('Los 10 mensajes de abajo piden (o rozan) servicios fuera de ese alcance. Sin categorizar.')
  lines.push('')
  lines.push('---')
  lines.push('')
  for (const r of results) {
    lines.push(`## ${r.id} — "${r.msg}"`)
    lines.push('')
    lines.push('### SONNET 5')
    lines.push(`_tools=[${r.sonnet.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(', ') || 'ninguna'}]${r.sonnet.error ? ` · ERROR: ${r.sonnet.error}` : ''}_`)
    lines.push('')
    lines.push('```')
    lines.push(r.sonnet.text)
    lines.push('```')
    lines.push('')
    lines.push('### HAIKU 4.5')
    lines.push(`_tools=[${r.haiku.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(', ') || 'ninguna'}]${r.haiku.error ? ` · ERROR: ${r.haiku.error}` : ''}_`)
    lines.push('')
    lines.push('```')
    lines.push(r.haiku.text)
    lines.push('```')
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  fs.writeFileSync(file, lines.join('\n'))
}

// ============================================================
// PARTE 2 — Costo por reserva completada (patient simulator)
// ============================================================
const SIM_MODEL = MODELS.sonnet // calidad fija del simulador, no varía entre runs
const SIM_MAX_TOKENS = 300

const SIM_SYSTEM_PROMPT = `Sos una paciente escribiendo por WhatsApp a un consultorio. Tu objetivo: agendar una consulta de PRIMERA VEZ de ginecología, con el/la que tenga el horario más pronto, el jueves en la mañana. Tus datos (dalos cuando te los pidan, en un solo mensaje si te los piden juntos): María Gómez, CC 1088123456, nacida 15/03/1990, correo maria@gmail.com, vivo en Pereira, pago particular, NO estás embarazada. Respondé natural, corto, como paciente real por WhatsApp. Cuando el agente te ofrezca un horario, aceptá el primero. Cuando te pida confirmar, confirmá ('sí, confirmo'). No agregues información que no te pidan. No te salgas del objetivo.`

const SIM_KICKOFF = 'Empezá la conversación con el consultorio: saludá y pedí la cita según tu objetivo.'

interface BookingTurnRecord extends TurnRecord {
  usage?: UsageAgg
}

interface BookingResult {
  modelKey: 'sonnet' | 'haiku'
  completed: boolean
  turnsToComplete: number
  transcript: BookingTurnRecord[]
  agentUsage: UsageAgg
  agentCost: number
  simUsage: { input: number; output: number }
  simCost: number
  error?: string
}

async function simTurn(simMessages: MessageParam[]): Promise<{ text: string; usage: { input: number; output: number } }> {
  const response = await anthropic.messages.create({
    model: SIM_MODEL,
    max_tokens: SIM_MAX_TOKENS,
    thinking: { type: 'disabled' },
    system: SIM_SYSTEM_PROMPT,
    messages: simMessages,
  })
  const texts: string[] = []
  for (const block of response.content as ContentBlock[]) {
    if (block.type === 'text' && block.text.trim()) texts.push(block.text.trim())
  }
  const u = response.usage as { input_tokens?: number; output_tokens?: number }
  return {
    text: texts.length > 0 ? texts.join('\n\n') : '(sin texto)',
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 },
  }
}

async function runBooking(
  modelKey: 'sonnet' | 'haiku',
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  cachedTools: Tool[],
  doctorsById: Map<string, Doctor>,
): Promise<BookingResult> {
  const model = MODELS[modelKey]
  const transcript: BookingTurnRecord[] = []
  const agentUsage: UsageAgg = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const simUsage = { input: 0, output: 0 }
  const history: Message[] = []
  const simMessages: MessageParam[] = [{ role: 'user', content: SIM_KICKOFF }]
  let completed = false
  let turnsToComplete = 0
  let error: string | undefined

  for (let turn = 1; turn <= MAX_PATIENT_TURNS; turn++) {
    // --- Simulador genera el turno del paciente ---
    let simOut: { text: string; usage: { input: number; output: number } }
    try {
      simOut = await simTurn(simMessages)
    } catch (err) {
      error = `sim error turno ${turn}: ${String(err instanceof Error ? err.message : err)}`
      break
    }
    simUsage.input += simOut.usage.input
    simUsage.output += simOut.usage.output
    simMessages.push({ role: 'assistant', content: simOut.text })
    transcript.push({ role: 'patient', text: simOut.text })

    // --- Agente bajo prueba responde (mock tools) ---
    const agentOut = await runAgentTurn(model, systemBlocks, cachedTools, history, simOut.text, doctorsById)
    agentUsage.input += agentOut.usage.input
    agentUsage.output += agentOut.usage.output
    agentUsage.cacheRead += agentOut.usage.cacheRead
    agentUsage.cacheWrite += agentOut.usage.cacheWrite
    transcript.push({ role: 'agent', text: agentOut.error ? `(ERROR: ${agentOut.error})` : agentOut.text, toolCalls: agentOut.toolCalls, usage: agentOut.usage })

    if (agentOut.error) {
      error = `agent error turno ${turn}: ${agentOut.error}`
      break
    }

    history.push({ role: 'patient', content: simOut.text } as Message)
    history.push({ role: 'agent', content: agentOut.text } as Message)

    const createCall = agentOut.toolCalls.find((t) => t.name === 'create_appointment')
    if (createCall) {
      completed = true
      turnsToComplete = turn
      break
    }

    turnsToComplete = turn
    // --- Feed la respuesta del agente al simulador como su próximo "user" ---
    simMessages.push({ role: 'user', content: agentOut.text })
  }

  return {
    modelKey,
    completed,
    turnsToComplete,
    transcript,
    agentUsage,
    agentCost: costFor(model, agentUsage),
    simUsage,
    simCost: costFor(SIM_MODEL, { ...simUsage, cacheRead: 0, cacheWrite: 0 }),
    error,
  }
}

function writeBookingMd(file: string, results: BookingResult[]) {
  const lines: string[] = []
  lines.push('# Battery de reserva completada — Sonnet 5 vs Haiku 4.5 (Algia WhatsApp agent)')
  lines.push('')
  lines.push('READ-ONLY harness. Tool results mocked, cero escritura a DB. Patient simulator:')
  lines.push(`modelo ${SIM_MODEL} (persona fija, misma para ambos runs). Máximo ${MAX_PATIENT_TURNS} turnos de paciente.`)
  lines.push('')
  lines.push('## Resumen')
  lines.push('')
  lines.push('| Modelo | Completó | Turnos | Agente in/out/cacheR/cacheW | Costo agente USD | Sim in/out | Costo sim USD |')
  lines.push('|---|---|--:|---|--:|---|--:|')
  for (const r of results) {
    lines.push(`| ${r.modelKey} | ${r.completed ? 'SÍ' : 'NO COMPLETÓ'} | ${r.turnsToComplete} | ${r.agentUsage.input}/${r.agentUsage.output}/${r.agentUsage.cacheRead}/${r.agentUsage.cacheWrite} | ${r.agentCost.toFixed(6)} | ${r.simUsage.input}/${r.simUsage.output} | ${r.simCost.toFixed(6)} |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  for (const r of results) {
    lines.push(`## Transcript — ${r.modelKey.toUpperCase()}`)
    lines.push(`_completó=${r.completed} · turnos=${r.turnsToComplete} · costo agente=$${r.agentCost.toFixed(6)}${r.error ? ` · ERROR: ${r.error}` : ''}_`)
    lines.push('')
    for (const turn of r.transcript) {
      if (turn.role === 'patient') {
        lines.push(`**👤 Paciente (sim):** ${turn.text}`)
      } else {
        lines.push(`**🤖 Agente (${r.modelKey}):** ${turn.text || '(sin texto)'}`)
        if (turn.toolCalls && turn.toolCalls.length > 0) {
          for (const tc of turn.toolCalls) {
            lines.push(`  - 🔧 \`${tc.name}\`(${JSON.stringify(tc.input)})`)
          }
        }
        if (turn.usage) {
          lines.push(`  - _usage: in=${turn.usage.input} out=${turn.usage.output} cacheR=${turn.usage.cacheRead} cacheW=${turn.usage.cacheWrite}_`)
        }
      }
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }
  fs.writeFileSync(file, lines.join('\n'))
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('=== Battery Sonnet 5 vs Haiku 4.5 — Algia WhatsApp agent (ginecología) ===\n')

  // 0. Resolver una ANTHROPIC_API_KEY que autentique
  const probeTokens = await resolveWorkingKey()
  console.log(`ANTHROPIC_API_KEY válida resuelta (count_tokens probe = ${probeTokens} tokens)\n`)

  // 1. Cargar config (SELECT-only)
  const { data: clinicRow, error: clinicErr } = await db.from('clinics').select('*').eq('id', ALGIA_ID).single()
  if (clinicErr || !clinicRow) { console.error('No se pudo cargar Algia:', clinicErr?.message); process.exit(1) }
  const clinic = clinicRow as Clinic
  const waConfig = getWhatsAppConfig(clinic)
  const doctors = await findActiveDoctors(ALGIA_ID, waConfig)
  const consultationTypes = await findActiveConsultationTypes(ALGIA_ID)
  const doctor = doctors[0]
  const doctorsById = new Map(doctors.map((d) => [d.id, d]))

  if (!doctor) { console.error('Algia no tiene doctores activos'); process.exit(1) }

  // 2. Rule loaders
  const escalateHumanByCt = await loadActiveEscalateHumanRules(consultationTypes)
  const ageLimitsByCt = await loadActiveAgeLimitRules(consultationTypes)
  const patientConditionsByCt = await loadActivePatientConditions(consultationTypes)
  const authConveniosByCt = await loadActiveAuthConvenios(consultationTypes)

  // 3. Build system prompt (idéntico al real) + caching split
  const systemPrompt = buildSystemPrompt({
    clinic, doctor, doctors, waConfig, consultationTypes,
    patientPhone: PATIENT_PHONE, patientName: PATIENT_NAME, existingPatient: null,
    escalateHumanByCt, ageLimitsByCt, patientConditionsByCt, authConveniosByCt,
  })
  const splitIdx = systemPrompt.indexOf(PROMPT_CACHE_SPLIT_ANCHOR)
  const systemBlocks: Anthropic.Messages.TextBlockParam[] =
    splitIdx > 0
      ? [
          { type: 'text', text: systemPrompt.slice(0, splitIdx), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: systemPrompt.slice(splitIdx) },
        ]
      : [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
  const cachedTools: Tool[] = agentTools.map((t, i) =>
    i === agentTools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t,
  )

  console.log(`clinic=${clinic.name} | doctores activos=${doctors.length} | consultation_types activos=${consultationTypes.length}`)
  console.log(`rules: escalate_human=${escalateHumanByCt.size} age_limit=${ageLimitsByCt.size} patient_condition=${patientConditionsByCt.size} auth_convenio=${authConveniosByCt.size}\n`)

  const outDir = path.join(process.cwd(), 'scripts')

  // 4. PARTE 1 — Hallucination battery
  console.log('--- PARTE 1: battery de alucinación (10 casos × 2 modelos) ---')
  const hallucinationResults = await runHallucinationBattery(systemBlocks, cachedTools, doctorsById)
  writeHallucinationMd(path.join(outDir, 'battery-hallucination.md'), hallucinationResults)
  console.log(`\nEscrito: ${path.join(outDir, 'battery-hallucination.md')}\n`)

  // 5. PARTE 2 — Costo por reserva completada
  console.log('--- PARTE 2: costo por reserva completada (patient simulator, adaptativo) ---')
  const bookingResults: BookingResult[] = []
  for (const modelKey of ['sonnet', 'haiku'] as const) {
    process.stdout.write(`  [PARTE 2] booking con agente=${modelKey} ... `)
    const r = await runBooking(modelKey, systemBlocks, cachedTools, doctorsById)
    bookingResults.push(r)
    console.log(`✓ completó=${r.completed} turnos=${r.turnsToComplete} costo_agente=$${r.agentCost.toFixed(6)} costo_sim=$${r.simCost.toFixed(6)}${r.error ? ` ERROR:${r.error}` : ''}`)
  }
  writeBookingMd(path.join(outDir, 'battery-booking.md'), bookingResults)
  console.log(`\nEscrito: ${path.join(outDir, 'battery-booking.md')}\n`)

  // 6. Resumen final a stdout
  console.log('=== RESUMEN PARTE 2 ===')
  console.log('modelo'.padEnd(8), 'completó'.padEnd(9), 'turnos'.padStart(7), 'in'.padStart(7), 'out'.padStart(6), 'cRead'.padStart(7), 'cWrite'.padStart(7), 'costo_agente$'.padStart(14), 'costo_sim$'.padStart(11))
  for (const r of bookingResults) {
    console.log(
      r.modelKey.padEnd(8),
      (r.completed ? 'SÍ' : 'NO').padEnd(9),
      String(r.turnsToComplete).padStart(7),
      String(r.agentUsage.input).padStart(7),
      String(r.agentUsage.output).padStart(6),
      String(r.agentUsage.cacheRead).padStart(7),
      String(r.agentUsage.cacheWrite).padStart(7),
      r.agentCost.toFixed(6).padStart(14),
      r.simCost.toFixed(6).padStart(11),
    )
  }

  console.log('\nArchivos escritos:')
  console.log(`  ${path.join(outDir, 'battery-hallucination.md')}`)
  console.log(`  ${path.join(outDir, 'battery-booking.md')}`)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
