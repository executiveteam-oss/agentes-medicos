/**
 * A/B eval harness — Sonnet 5 vs Haiku 4.5 para el agente WhatsApp de Algia.
 *
 * 🚨 READ-ONLY. NUNCA escribe a la DB:
 *   - NO importa ni llama al executeTool real (src/agents/tools/executor.ts).
 *   - Usa un MOCK tool executor (shape-faithful, sin efectos).
 *   - Solo SELECTs para cargar config (clinic, doctors, consultation_types, rules, messages).
 *
 * Replica FIELMENTE el loop real (appointment-agent.ts) con 3 cambios:
 *   (1) el modelo es un parámetro
 *   (2) la ejecución de tools es mockeada
 *   (3) captura el usage COMPLETO por llamada (input, output, cache_read, cache_creation)
 *
 * Todo lo demás es idéntico: thinking disabled, max_tokens 1024, prompt-caching split
 * (systemBlocks con cache_control en el prefijo estable via PROMPT_CACHE_SPLIT_ANCHOR,
 * y cachedTools con cache_control en la última tool), MAX_TOOL_ITERATIONS=5,
 * la lógica de collectedTexts / escalateToHumanCalled.
 *
 * Run:  npx tsx scripts/ab-sonnet-vs-haiku.ts
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
import type { Clinic, ConsultationType, Doctor, Message, WhatsAppConfig } from '@/types/database'

// ============================================================
// Env loader (dotenv-lite): .env.production.local luego .env.local
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

// Candidatos de ANTHROPIC_API_KEY en orden de preferencia. El load order pedido
// (.env.production.local → .env.local) sigue siendo primario, pero validamos la
// key contra la API y caemos al siguiente candidato si está revocada (401). Sin
// esto el harness muere en 401 aunque exista una key válida en otro archivo.
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
interface RunResult {
  scenario: string
  model: 'sonnet' | 'haiku'
  transcript: TurnRecord[]
  toolCalls: ToolCallRecord[]
  escalations: Array<{ reason: string; urgency: string }>
  usage: UsageAgg
  costUsd: number
  error?: string
}

// ============================================================
// MOCK tool executor — shape-faithful, cero escritura
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

// calculate_date es determinístico y sin DB → replicamos la lógica REAL tal cual
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
      // "covered" plausible: particular/covered, sin autorización requerida
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
  // Replicado de getActivePatientConditionRulesForCts (query directa para no
  // importar el server action 'use server' + next/cache en un script standalone).
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
// Escenarios
// ============================================================
const REPLAY_IDS = [
  '24421d61-47a5-483b-903c-0f6ca5bf5aac',
  'c111690d-d9aa-4286-b6f0-80c19978108c',
  '08fdfb01-bd71-4e27-8e8e-02a7da0fa99d',
  '854d1d7c-2ebc-4738-a7d1-28a7ade7fe6d',
  'bbe70c0c-d4da-42fc-a0b3-4143d82306fa',
  'd8cfcdff-9cef-4824-9161-528463308e2f',
]

const SINGLE_TURN: Array<{ name: string; msg: string }> = [
  { name: 'B1-toolchain-angelica-jueves', msg: 'quiero cita de ginecología con la Dra. Angélica el jueves' },
  { name: 'B2-kiero-cita-ginecologa', msg: 'kiero cita ginecologa' },
  { name: 'B3-cita', msg: 'cita' },
  { name: 'B4-tengo-14', msg: 'tengo 14 puedo ir?' },
  { name: 'B5-2-meses-embarazo', msg: 'tengo 2 meses de embarazo me pueden ver' },
  { name: 'B6-minor-hija-13', msg: 'hola, quiero una cita de ginecología para mi hija de 13 años' },
  { name: 'B7-pregnant-control', msg: 'estoy embarazada de 2 meses y quiero una cita de control' },
  { name: 'B8-colposcopia', msg: 'quiero una colposcopia' },
  { name: 'B9-control-posquirurgico', msg: 'necesito un control posquirúrgico' },
  { name: 'B10-mamografias', msg: 'hacen mamografías?' },
  { name: 'B11-rinoplastia', msg: 'quiero una cita para una rinoplastia' },
]

const MULTI_C: string[] = [
  'buenas, quiero agendar una cita de ginecología',
  'con la que tenga más pronto',
  'el jueves en la mañana',
  'la primera está bien',
  'sí, confirmo. María Gómez, cédula 1088123456, nací el 15/03/1990',
]

const MULTI_D: string[] = [
  'quiero cita de ginecología el jueves con la Dra. Angélica',
  'mejor con otra doctora',
  'y mejor el viernes, no el jueves',
  'sí, confirmá esa',
]

async function loadReplayTurns(conversationId: string): Promise<string[]> {
  const { data } = await db
    .from('messages')
    .select('content, role, created_at')
    .eq('conversation_id', conversationId)
    .eq('role', 'patient')
    .order('created_at', { ascending: true })
  return (data ?? []).map((m) => (m as { content: string }).content).filter((c) => c && c.trim())
}

// ============================================================
// Runner
// ============================================================
function costFor(model: string, u: UsageAgg): number {
  const p = PRICING[model]
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.input * 0.1 + u.cacheWrite * p.input * 1.25) / 1_000_000
}

async function runConversation(
  scenario: string,
  modelKey: 'sonnet' | 'haiku',
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  cachedTools: Tool[],
  patientTurns: string[],
  doctorsById: Map<string, Doctor>,
): Promise<RunResult> {
  const model = MODELS[modelKey]
  const transcript: TurnRecord[] = []
  const allToolCalls: ToolCallRecord[] = []
  const allEscalations: Array<{ reason: string; urgency: string }> = []
  const agg: UsageAgg = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const history: Message[] = []
  let firstError: string | undefined

  for (const patientTurn of patientTurns) {
    transcript.push({ role: 'patient', text: patientTurn })
    const out = await runAgentTurn(model, systemBlocks, cachedTools, history, patientTurn, doctorsById)
    agg.input += out.usage.input; agg.output += out.usage.output; agg.cacheRead += out.usage.cacheRead; agg.cacheWrite += out.usage.cacheWrite
    for (const t of out.toolCalls) allToolCalls.push(t)
    for (const e of out.escalations) allEscalations.push(e)
    if (out.error && !firstError) firstError = out.error
    transcript.push({ role: 'agent', text: out.error ? `(ERROR: ${out.error})` : out.text, toolCalls: out.toolCalls })
    // Actualizar history para el próximo turno
    history.push({ role: 'patient', content: patientTurn } as Message)
    history.push({ role: 'agent', content: out.error ? '(error)' : out.text } as Message)
    if (out.error) break // no seguir el multi-turno si la API falló
  }

  return {
    scenario, model: modelKey, transcript,
    toolCalls: allToolCalls, escalations: allEscalations,
    usage: agg, costUsd: costFor(model, agg), error: firstError,
  }
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('=== A/B Sonnet 5 vs Haiku 4.5 — Algia WhatsApp agent ===\n')

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

  // 4. Fidelity self-check
  const approxTokens = Math.round(systemPrompt.length / 4)
  let countTokens = -1
  try {
    const ct = await anthropic.messages.countTokens({
      model: MODELS.sonnet,
      system: systemBlocks.map((b) => ({ type: 'text' as const, text: b.text })),
      tools: agentTools,
      messages: [{ role: 'user', content: 'hola' }],
    })
    countTokens = ct.input_tokens
  } catch (e) { countTokens = -1 }

  console.log('--- FIDELITY SELF-CHECK ---')
  console.log(`clinic=${clinic.name} | doctores activos=${doctors.length} | consultation_types activos=${consultationTypes.length}`)
  console.log(`rules: escalate_human=${escalateHumanByCt.size} age_limit=${ageLimitsByCt.size} patient_condition=${patientConditionsByCt.size} auth_convenio=${authConveniosByCt.size}`)
  console.log(`system prompt chars=${systemPrompt.length} | approx tokens (chars/4)=${approxTokens} | count_tokens(system+tools+msg)=${countTokens}`)
  console.log(`PROMPT_CACHE_SPLIT_ANCHOR found at idx=${splitIdx} (prefix cacheado, cola volátil)`)
  console.log(`\nFIRST 300 chars:\n${JSON.stringify(systemPrompt.slice(0, 300))}`)
  console.log(`\nLAST 300 chars:\n${JSON.stringify(systemPrompt.slice(-300))}`)
  console.log('---------------------------\n')

  // 5. Construir lista de escenarios (patientTurns[]) EN ORDEN DE PRIORIDAD.
  //    Si el crédito se corta a mitad (ya pasó), queremos los casos DECISIVOS
  //    primero: la ALUCINACIÓN es la única sin red del executor → va primera.
  //    Orden: 1) alucinación, 2) reglas, 3) multi-turno (cadena de tools +
  //    contexto), 4) resto single-turn, 5) replays (ya corrieron, menos decisivos).
  const scenarios: Array<{ name: string; turns: string[] }> = []
  const byName = (n: string) => SINGLE_TURN.find((s) => s.name === n)!
  const asScenario = (n: string) => ({ name: byName(n).name, turns: [byName(n).msg] })
  // 1) ALUCINACIÓN (decisivo)
  for (const n of ['B10-mamografias', 'B11-rinoplastia']) scenarios.push(asScenario(n))
  // 2) REGLAS (edad, embarazo, colposcopia, posquirúrgico)
  for (const n of ['B4-tengo-14', 'B5-2-meses-embarazo', 'B6-minor-hija-13', 'B7-pregnant-control', 'B8-colposcopia', 'B9-control-posquirurgico']) scenarios.push(asScenario(n))
  // 3) MULTI-TURNO (cadena de tools end-to-end + retención de contexto)
  scenarios.push({ name: 'C-multiturn-e2e', turns: MULTI_C })
  scenarios.push({ name: 'D-multiturn-mindchange', turns: MULTI_D })
  // 4) RESTO single-turn
  for (const n of ['B1-toolchain-angelica-jueves', 'B2-kiero-cita-ginecologa', 'B3-cita']) scenarios.push(asScenario(n))
  // 5) REPLAYS (ya corrieron una vez; van al final)
  for (let i = 0; i < REPLAY_IDS.length; i++) {
    const turns = await loadReplayTurns(REPLAY_IDS[i])
    scenarios.push({ name: `A${i + 1}-replay-${REPLAY_IDS[i].slice(0, 8)}`, turns: turns.slice(0, 15) })
  }

  console.log(`Escenarios: ${scenarios.length} × 2 modelos = ${scenarios.length * 2} conversaciones\n`)

  // 6. Ejecutar. Aborta la suite si la cuenta se queda sin crédito (400
  //    "credit balance too low") — seguir hammering solo genera 38 errores
  //    idénticos. Los resultados ya recolectados se escriben igual.
  const results: RunResult[] = []
  let creditExhausted = false
  outer:
  for (const sc of scenarios) {
    for (const modelKey of ['sonnet', 'haiku'] as const) {
      process.stdout.write(`  [${modelKey}] ${sc.name} (${sc.turns.length} turnos)... `)
      const r = await runConversation(sc.name, modelKey, systemBlocks, cachedTools, sc.turns, doctorsById)
      results.push(r)
      console.log(`✓ tools=[${r.toolCalls.map((t) => t.name).join(',')}] in=${r.usage.input} out=${r.usage.output} cr=${r.usage.cacheRead} $${r.costUsd.toFixed(5)}${r.error ? ` ERROR:${r.error}` : ''}`)
      if (r.error && /credit balance/i.test(r.error)) {
        creditExhausted = true
        console.log('\n⛔ BLOCKER: la cuenta Anthropic se quedó sin crédito. Abortando el resto de escenarios.')
        console.log('   Recargá crédito (Plans & Billing) y volvé a correr para completar B/C/D.')
        break outer
      }
    }
  }
  if (creditExhausted) console.log(`\n(Se completaron ${results.filter((r) => !r.error).length} runs con datos reales antes del corte)\n`)

  // 7. Escribir outputs
  const outDir = path.join(process.cwd(), 'scripts')
  fs.writeFileSync(path.join(outDir, 'ab-results.json'), JSON.stringify(results, null, 2))
  writeTranscriptsMd(path.join(outDir, 'ab-transcripts.md'), scenarios.map((s) => s.name), results, {
    approxTokens, countTokens, chars: systemPrompt.length, splitIdx,
    doctors: doctors.length, cts: consultationTypes.length,
  })

  // 8. Tabla compacta + divergencias (a stdout)
  console.log('\n=== TABLA compacta (tokens + costo) ===')
  console.log('scenario'.padEnd(34), 'model'.padEnd(7), 'in'.padStart(7), 'out'.padStart(6), 'cRead'.padStart(7), 'cWrite'.padStart(7), 'cost$'.padStart(9))
  for (const sc of scenarios) {
    for (const mk of ['sonnet', 'haiku'] as const) {
      const r = results.find((x) => x.scenario === sc.name && x.model === mk)!
      console.log(sc.name.padEnd(34), mk.padEnd(7), String(r.usage.input).padStart(7), String(r.usage.output).padStart(6), String(r.usage.cacheRead).padStart(7), String(r.usage.cacheWrite).padStart(7), r.costUsd.toFixed(6).padStart(9))
    }
  }

  console.log('\n=== DIVERGENCIAS DE COMPORTAMIENTO (flat) ===')
  const divergences = computeDivergences(scenarios.map((s) => s.name), results)
  if (divergences.length === 0) console.log('(ninguna detectada)')
  for (const d of divergences) console.log(`  - ${d}`)

  console.log('\nArchivos escritos:')
  console.log(`  ${path.join(outDir, 'ab-results.json')}`)
  console.log(`  ${path.join(outDir, 'ab-transcripts.md')}`)
}

function computeDivergences(names: string[], results: RunResult[]): string[] {
  const out: string[] = []
  for (const name of names) {
    const s = results.find((r) => r.scenario === name && r.model === 'sonnet')
    const h = results.find((r) => r.scenario === name && r.model === 'haiku')
    if (!s || !h) continue
    const reasons: string[] = []
    if (s.error || h.error) reasons.push(`API error (sonnet:${s.error ?? 'ok'} haiku:${h.error ?? 'ok'})`)
    const sTools = s.toolCalls.map((t) => t.name).join('>')
    const hTools = h.toolCalls.map((t) => t.name).join('>')
    if (sTools !== hTools) reasons.push(`tool chain difiere (sonnet=[${sTools}] haiku=[${hTools}])`)
    const sEsc = s.escalations.length > 0
    const hEsc = h.escalations.length > 0
    if (sEsc !== hEsc) reasons.push(`escalación difiere (sonnet=${sEsc} haiku=${hEsc})`)
    // params: comparar inputs de create_appointment (doctor/starts_at) si ambos crearon
    const sCreate = s.toolCalls.find((t) => t.name === 'create_appointment')
    const hCreate = h.toolCalls.find((t) => t.name === 'create_appointment')
    if (sCreate && hCreate) {
      if (JSON.stringify(sCreate.input.doctor_id) !== JSON.stringify(hCreate.input.doctor_id)) reasons.push('create_appointment doctor_id difiere')
      if (JSON.stringify(sCreate.input.starts_at) !== JSON.stringify(hCreate.input.starts_at)) reasons.push('create_appointment starts_at difiere')
    } else if (!!sCreate !== !!hCreate) {
      reasons.push(`solo un modelo llamó create_appointment (sonnet=${!!sCreate} haiku=${!!hCreate})`)
    }
    if (reasons.length > 0) out.push(`${name}: ${reasons.join(' | ')}`)
  }
  return out
}

function writeTranscriptsMd(
  file: string,
  names: string[],
  results: RunResult[],
  fidelity: { approxTokens: number; countTokens: number; chars: number; splitIdx: number; doctors: number; cts: number },
) {
  const lines: string[] = []
  lines.push('# A/B Transcripts — Sonnet 5 vs Haiku 4.5 (Algia WhatsApp agent)')
  lines.push('')
  lines.push('READ-ONLY harness. Tool results mocked, cero escritura a DB.')
  lines.push('')
  lines.push('## Fidelity self-check')
  lines.push(`- system prompt: ${fidelity.chars} chars, ~${fidelity.approxTokens} tokens (chars/4), count_tokens=${fidelity.countTokens}`)
  lines.push(`- doctores activos=${fidelity.doctors}, consultation_types activos=${fidelity.cts}, cache split idx=${fidelity.splitIdx}`)
  lines.push('')
  lines.push('## Costos por escenario')
  lines.push('')
  lines.push('| Escenario | Modelo | in | out | cacheRead | cacheWrite | costo USD |')
  lines.push('|---|---|--:|--:|--:|--:|--:|')
  for (const name of names) {
    for (const mk of ['sonnet', 'haiku'] as const) {
      const r = results.find((x) => x.scenario === name && x.model === mk)
      if (!r) continue
      lines.push(`| ${name} | ${mk} | ${r.usage.input} | ${r.usage.output} | ${r.usage.cacheRead} | ${r.usage.cacheWrite} | ${r.costUsd.toFixed(6)} |`)
    }
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const name of names) {
    const s = results.find((x) => x.scenario === name && x.model === 'sonnet')
    const h = results.find((x) => x.scenario === name && x.model === 'haiku')
    lines.push(`## ${name}`)
    lines.push('')
    for (const [label, r] of [['SONNET 5', s], ['HAIKU 4.5', h]] as const) {
      if (!r) continue
      lines.push(`### ${label}`)
      lines.push(`_tokens in=${r.usage.input} out=${r.usage.output} cacheRead=${r.usage.cacheRead} cacheWrite=${r.usage.cacheWrite} · costo $${r.costUsd.toFixed(6)}${r.error ? ` · ERROR: ${r.error}` : ''}_`)
      lines.push('')
      for (const turn of r.transcript) {
        if (turn.role === 'patient') {
          lines.push(`**👤 Paciente:** ${turn.text}`)
        } else {
          lines.push(`**🤖 Agente:** ${turn.text || '(sin texto)'}`)
          if (turn.toolCalls && turn.toolCalls.length > 0) {
            for (const tc of turn.toolCalls) {
              lines.push(`  - 🔧 \`${tc.name}\`(${JSON.stringify(tc.input)})`)
            }
          }
        }
        lines.push('')
      }
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }
  fs.writeFileSync(file, lines.join('\n'))
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
