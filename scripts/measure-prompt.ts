/**
 * Medidor de tokens del system prompt REAL de Algia, por sección.
 *
 * 🚨 READ-ONLY. NUNCA escribe a la DB:
 *   - Solo SELECTs para cargar config (clinic, doctors, consultation_types, rules).
 *   - NO llama a ningún tool executor, NO crea citas, NO manda mensajes.
 *   - El único uso de la API de Anthropic es `messages.countTokens`.
 *
 * ⚠️ FALLBACK DE APROXIMACIÓN: se intentó `count_tokens` con las 3 API keys
 * candidatas. 2 de 3 devuelven 401 (revocadas). La 3ra AUTENTICA (GET
 * /v1/models funciona) pero `count_tokens` devuelve 400 "credit balance too
 * low" — en esta cuenta el endpoint NO bypassea el chequeo de billing (esto
 * contradice la premisa de que count_tokens funciona a saldo cero; puede ser
 * cierto en general pero no lo es para esta cuenta puntual). Confirmado con
 * curl directo contra /v1/messages/count_tokens con payload mínimo.
 *
 * Ante esto, el script cae a una aproximación chars/4 (misma heurística ya
 * usada en scripts/ab-sonnet-vs-haiku.ts para su self-check). CLARAMENTE
 * ETIQUETADA como aproximada en toda la salida — no son conteos oficiales
 * de la API. Si en el futuro se resuelve el saldo de la cuenta, este mismo
 * script debería empezar a usar count_tokens real sin cambios (la función
 * countFragment ya intenta la API primero).
 *
 * Reutiliza el mismo loading que scripts/ab-sonnet-vs-haiku.ts (misma
 * clínica, mismos doctores/consultation_types/reglas, mismo buildSystemPrompt).
 *
 * Run:  npx tsx scripts/measure-prompt.ts
 *
 * Es temporal — se deja en el repo para volver a correr cuando haga falta.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'

import { buildSystemPrompt, PROMPT_CACHE_SPLIT_ANCHOR } from '@/agents/prompts/system-prompt'
import type { PatientConditionRuleInfo } from '@/agents/prompts/system-prompt'
import { agentTools } from '@/lib/anthropic/tools'
import type { Clinic, ConsultationType, Doctor, WhatsAppConfig } from '@/types/database'

// ============================================================
// Env loader (idéntico a ab-sonnet-vs-haiku.ts): .env.production.local →
// .env.local → .env.local.prod-backup
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
loadEnvFile('.env.local.prod-backup')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error('FALTA SUPABASE_URL o SERVICE_ROLE_KEY'); process.exit(1) }

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
const COUNT_MODEL = 'claude-sonnet-5' // count_tokens no cobra, el modelo solo define la tokenización

let anthropic = new Anthropic({ apiKey: UNIQUE_KEYS[0] ?? 'placeholder' })
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Si count_tokens falla en TODAS las keys candidatas (401 revocada, o 400
// "credit balance too low" — visto en esta cuenta), caemos a aproximación
// chars/4. Ver comentario de cabecera del archivo.
let APPROX_MODE = false
let APPROX_REASON = ''

async function resolveWorkingKey(): Promise<void> {
  if (UNIQUE_KEYS.length === 0) {
    APPROX_MODE = true
    APPROX_REASON = 'no hay ANTHROPIC_API_KEY en env ni en los .env'
    return
  }
  const errors: string[] = []
  for (const k of UNIQUE_KEYS) {
    try {
      const c = new Anthropic({ apiKey: k })
      await c.messages.countTokens({ model: COUNT_MODEL, messages: [{ role: 'user', content: 'hola' }] })
      anthropic = c
      return
    } catch (e) {
      errors.push(String(e instanceof Error ? e.message : e))
    }
  }
  APPROX_MODE = true
  APPROX_REASON = `las ${UNIQUE_KEYS.length} ANTHROPIC_API_KEY candidatas fallaron count_tokens: ${errors.join(' | ')}`
}

// Test patient (no toca DB — solo se inyecta al prompt, igual que el harness A/B)
const PATIENT_PHONE = '+573001112233'
const PATIENT_NAME = 'Paciente'

// ============================================================
// Rule loaders (copiados 1:1 de ab-sonnet-vs-haiku.ts — solo SELECT)
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
// Data loading (copiado 1:1 de ab-sonnet-vs-haiku.ts)
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
// Helper: count_tokens de un fragmento de texto, aislado de overhead.
// Se resta un baseline (system mínimo + mensaje trivial) para que el
// número reportado sea el peso REAL del fragmento, no el overhead fijo
// de la request.
// ============================================================
let baselineTokens = 0

// chars/4 — misma heurística ya usada en scripts/ab-sonnet-vs-haiku.ts
// (variable approxTokens). Aproximación gruesa para texto en español/inglés
// mixto con emojis y bloques de código; usarla solo como fallback etiquetado.
function approxTokensFromChars(text: string): number {
  return Math.round(text.length / 4)
}

async function countFragment(text: string): Promise<number> {
  if (text.trim().length === 0) return 0
  if (APPROX_MODE) return approxTokensFromChars(text)
  const r = await anthropic.messages.countTokens({
    model: COUNT_MODEL,
    system: [{ type: 'text', text }],
    messages: [{ role: 'user', content: 'hola' }],
  })
  return Math.max(0, r.input_tokens - baselineTokens)
}

async function countRaw(params: { system?: Anthropic.Messages.TextBlockParam[]; tools?: Tool[] }): Promise<number> {
  if (APPROX_MODE) {
    const systemChars = (params.system ?? []).reduce((a, b) => a + b.text.length, 0)
    const toolsChars = params.tools ? JSON.stringify(params.tools).length : 0
    return Math.round((systemChars + toolsChars) / 4) + 3 // +3 ~ mensaje trivial 'hola'
  }
  // Guard: count_tokens rechaza bloques de texto vacíos/whitespace (ej. FAQ vacía).
  const sys = (params.system ?? []).filter((b) => b.text.trim().length > 0)
  if (sys.length === 0 && !params.tools) return 0
  const r = await anthropic.messages.countTokens({
    model: COUNT_MODEL,
    system: sys.length > 0 ? sys : undefined,
    tools: params.tools,
    messages: [{ role: 'user', content: 'hola' }],
  })
  return r.input_tokens
}

// ============================================================
// Construcción de la versión HIPOTÉTICA "solo nombres" del catálogo
// ============================================================
function buildNamesOnlyCatalog(doctors: Doctor[], consultationTypes: ConsultationType[]): string {
  const lines: string[] = ['DOCTORES DISPONIBLES:']
  for (const d of doctors) {
    const doctorTypes = consultationTypes.filter((ct) => ct.doctor_id === d.id && ct.is_active)
    const names = doctorTypes.map((ct) => ct.name)
    lines.push(`  - ${d.name}: ${names.length > 0 ? names.join(', ') : '(sin tipos de consulta configurados)'}`)
  }
  return lines.join('\n')
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('=== Medición de tokens del system prompt real — Algia ===\n')

  await resolveWorkingKey()

  if (APPROX_MODE) {
    console.log('⚠️⚠️⚠️ MODO APROXIMADO — count_tokens NO disponible ⚠️⚠️⚠️')
    console.log(`Razón: ${APPROX_REASON}`)
    console.log('TODOS los números de abajo son ESTIMACIONES chars/4, NO conteos oficiales de la API Anthropic.')
    console.log('Método: Math.round(caracteres_del_fragmento / 4). Suficiente para comparar proporciones')
    console.log('entre secciones, pero el TOTAL puede diferir del conteo real en +/-15-20%.\n')
  }

  // Baseline: system mínimo (1 char) + mensaje trivial 'hola'
  baselineTokens = await countRaw({ system: [{ type: 'text', text: ' ' }] })
  if (!APPROX_MODE) {
    console.log(`Baseline (system mínimo + mensaje 'hola'): ${baselineTokens} tokens (se resta de cada fragmento medido)\n`)
  }

  // 1. Cargar config real de Algia (SELECT-only)
  const { data: clinicRow, error: clinicErr } = await db.from('clinics').select('*').eq('id', ALGIA_ID).single()
  if (clinicErr || !clinicRow) { console.error('No se pudo cargar Algia:', clinicErr?.message); process.exit(1) }
  const clinic = clinicRow as Clinic
  const waConfig = getWhatsAppConfig(clinic)
  const doctors = await findActiveDoctors(ALGIA_ID, waConfig)
  const consultationTypes = await findActiveConsultationTypes(ALGIA_ID)
  const doctor = doctors[0]
  if (!doctor) { console.error('Algia no tiene doctores activos'); process.exit(1) }

  const escalateHumanByCt = await loadActiveEscalateHumanRules(consultationTypes)
  const ageLimitsByCt = await loadActiveAgeLimitRules(consultationTypes)
  const patientConditionsByCt = await loadActivePatientConditions(consultationTypes)
  const authConveniosByCt = await loadActiveAuthConvenios(consultationTypes)

  // 2. Construir el system prompt REAL (idéntico al agente en producción)
  const systemPrompt = buildSystemPrompt({
    clinic, doctor, doctors, waConfig, consultationTypes,
    patientPhone: PATIENT_PHONE, patientName: PATIENT_NAME, existingPatient: null,
    escalateHumanByCt, ageLimitsByCt, patientConditionsByCt, authConveniosByCt,
  })

  console.log(`clinic=${clinic.name} | doctores activos=${doctors.length} | consultation_types activos=${consultationTypes.length}`)
  console.log(`rules: escalate_human=${escalateHumanByCt.size} age_limit=${ageLimitsByCt.size} patient_condition=${patientConditionsByCt.size} auth_convenio=${authConveniosByCt.size}`)
  console.log(`system prompt: ${systemPrompt.length} chars\n`)

  // ============================================================
  // (1) TOTAL
  // ============================================================
  const totalTokens = await countFragment(systemPrompt)

  // ============================================================
  // (2) TOOLS weight
  // ============================================================
  const baselineNoTools = await countRaw({ system: [{ type: 'text', text: ' ' }] })
  const withTools = await countRaw({ system: [{ type: 'text', text: ' ' }], tools: agentTools })
  const toolsWeight = withTools - baselineNoTools

  // ============================================================
  // (3) Secciones lógicas — boundaries via marcadores literales del template
  //     (src/agents/prompts/system-prompt.ts)
  // ============================================================
  const S = systemPrompt
  const idxDoctores = S.indexOf('DOCTORES DISPONIBLES:')
  if (idxDoctores === -1) { console.error('BLOCKER: no se encontró el marcador "DOCTORES DISPONIBLES:" — el template cambió, actualizar el script.'); process.exit(1) }

  // Fin del catálogo doctor+CT = primer marcador de las reglas que siguen al catálogo
  // (concatenadas en este orden fijo: agendaClosedRules, multiDoctorRules,
  // manualScheduleRules, consultationTypeRules, virtualRules)
  const postCatalogMarkers = [
    'REGLAS DE AGENDA CERRADA:',
    'REGLAS MULTI-DOCTOR — INICIO DE AGENDAMIENTO:',
    'REGLAS DE DISPONIBILIDAD MANUAL:',
    'REGLAS DE TIPOS DE CONSULTA:',
    'REGLAS DE CONSULTAS VIRTUALES:',
  ]
  const searchFrom = idxDoctores + 'DOCTORES DISPONIBLES:'.length
  let idxCatalogEnd = -1
  for (const m of postCatalogMarkers) {
    const i = S.indexOf(m, searchFrom)
    if (i !== -1 && (idxCatalogEnd === -1 || i < idxCatalogEnd)) idxCatalogEnd = i
  }
  const idxInquebrantables = S.indexOf('REGLAS INQUEBRANTABLES:')
  if (idxCatalogEnd === -1) idxCatalogEnd = idxInquebrantables // fallback si ninguna regla post-catálogo aplicó
  if (idxInquebrantables === -1) { console.error('BLOCKER: no se encontró "REGLAS INQUEBRANTABLES:" — el template cambió.'); process.exit(1) }

  const idxFaqMarker = S.indexOf('PREGUNTAS FRECUENTES:', idxCatalogEnd)
  const idxInfoMarker = S.indexOf('INFORMACIÓN ADICIONAL DE LA CLÍNICA:', idxCatalogEnd)
  const faqBlobStart = idxFaqMarker !== -1 ? idxFaqMarker : (idxInfoMarker !== -1 ? idxInfoMarker : idxInquebrantables)

  const headerSlice = S.slice(0, idxDoctores) // Header + ROL + INFO DEL CONSULTORIO + horarios + anticipación
  const catalogSlice = S.slice(idxDoctores, idxCatalogEnd) // DOCTORES DISPONIBLES: + doctorLines (el catálogo puro)
  const doctorRuleBlocksSlice = S.slice(idxCatalogEnd, faqBlobStart) // agenda cerrada / multi-doctor / manual / tipos consulta / virtual — reglas ESTÁTICAS ligadas al catálogo
  const faqSlice = S.slice(faqBlobStart, idxInquebrantables) // PREGUNTAS FRECUENTES + INFORMACIÓN ADICIONAL DE LA CLÍNICA (si existen)
  const rulesTailSlice = S.slice(idxInquebrantables) // REGLAS INQUEBRANTABLES: → hasta el final (incluye TODO lo posterior al cache anchor)

  const [headerTokens, catalogTokens, doctorRuleBlocksTokens, faqTokens, rulesTailTokens] = await Promise.all([
    countFragment(headerSlice),
    countFragment(catalogSlice),
    countFragment(doctorRuleBlocksSlice),
    countFragment(faqSlice),
    countFragment(rulesTailSlice),
  ])
  const rulesTokens = doctorRuleBlocksTokens + rulesTailTokens // bucket "RULES/instrucciones/tono/ejemplos" (todo lo demás estático)

  // ============================================================
  // (4) Cached prefix vs volatile tail (el split real de prompt caching)
  // ============================================================
  const splitIdx = S.indexOf(PROMPT_CACHE_SPLIT_ANCHOR)
  const cachedPrefixSlice = splitIdx > 0 ? S.slice(0, splitIdx) : S
  const volatileTailSlice = splitIdx > 0 ? S.slice(splitIdx) : ''
  const [cachedPrefixTokens, volatileTailTokens] = await Promise.all([
    countFragment(cachedPrefixSlice),
    countFragment(volatileTailSlice),
  ])

  // ============================================================
  // (5) Catálogo completo vs "solo nombres" (hipotético)
  // ============================================================
  const namesOnlyCatalog = buildNamesOnlyCatalog(doctors, consultationTypes)
  const namesOnlyTokens = await countFragment(namesOnlyCatalog)
  const catalogDelta = catalogTokens - namesOnlyTokens

  // ============================================================
  // OUTPUT
  // ============================================================
  console.log('--- (1) TOTAL ---')
  console.log(`System prompt completo: ${totalTokens} tokens\n`)

  console.log('--- (2) TOOLS weight ---')
  console.log(`agentTools (${agentTools.length} tools): ~${toolsWeight} tokens\n`)

  console.log('--- (3) Secciones lógicas (por tipo de contenido) ---')
  const sections: Array<{ name: string; tokens: number }> = [
    { name: 'Header + ROL + INFO DEL CONSULTORIO', tokens: headerTokens },
    { name: 'Catálogo DOCTOR + CONSULTATION-TYPE (detallado)', tokens: catalogTokens },
    { name: 'FAQ (+ info adicional clínica si existe)', tokens: faqTokens },
    { name: 'RULES / instrucciones / tono / ejemplos (resto estático)', tokens: rulesTokens },
  ]
  const sectionsSum = sections.reduce((a, s) => a + s.tokens, 0)
  console.log('sección'.padEnd(58), 'tokens'.padStart(8), '% total'.padStart(9))
  for (const s of sections) {
    console.log(s.name.padEnd(58), String(s.tokens).padStart(8), `${((s.tokens / totalTokens) * 100).toFixed(1)}%`.padStart(9))
  }
  console.log(`  (suma de secciones = ${sectionsSum}; total medido directo = ${totalTokens}; diferencia = ${totalTokens - sectionsSum} — overhead de tokenización en los bordes de cada fragmento, no material)\n`)
  console.log(`  Nota: dentro de "RULES" hay 2 sub-partes: reglas ligadas al catálogo (agenda cerrada/multi-doctor/tipos consulta/virtual) = ${doctorRuleBlocksTokens} tokens, + bloque estático final (REGLAS INQUEBRANTABLES en adelante, que incluye TODO lo posterior al cache-split anchor) = ${rulesTailTokens} tokens.\n`)

  console.log('--- (4) Cached prefix vs volatile tail (split real de prompt caching) ---')
  console.log(`PROMPT_CACHE_SPLIT_ANCHOR encontrado en idx=${splitIdx}`)
  console.log(`Prefijo cacheable (antes del anchor): ${cachedPrefixTokens} tokens (${((cachedPrefixTokens / totalTokens) * 100).toFixed(1)}%)`)
  console.log(`Cola volátil (desde "FECHA Y HORA ACTUAL:" hasta el final): ${volatileTailTokens} tokens (${((volatileTailTokens / totalTokens) * 100).toFixed(1)}%)`)
  console.log(`  ⚠️ OJO: la cola volátil NO es solo "fecha + datos del paciente" — incluye texto`)
  console.log(`  estático estable (Pasos 1-6 del flujo de agendamiento, reglas de recolección de`)
  console.log(`  datos, formato de output, etc.) que HOY se recalcula/retokeniza en cada llamada`)
  console.log(`  porque vive después del anchor. Ver rulesTailTokens arriba — es el mismo bloque.\n`)

  console.log('--- (5) Catálogo completo vs "solo nombres" (hipotético) ---')
  console.log(`consultation_types activos: ${consultationTypes.length} | doctores activos: ${doctors.length}`)
  console.log(`Catálogo completo (nombre+duración+precio+eps+marcas+sub-líneas+tipo_id): ${catalogTokens} tokens`)
  console.log(`Catálogo "solo nombres" (nombre agrupado por doctor, sin nada más): ${namesOnlyTokens} tokens`)
  console.log(`DIFERENCIA (lo que se ahorraría moviendo detalle a un tool): ${catalogDelta} tokens (${((catalogDelta / totalTokens) * 100).toFixed(1)}% del prompt total)\n`)

  console.log('=== TABLA RESUMEN ===')
  console.log('métrica'.padEnd(58), 'tokens'.padStart(8), '% total'.padStart(9))
  console.log('TOTAL system prompt'.padEnd(58), String(totalTokens).padStart(8), '100.0%'.padStart(9))
  for (const s of sections) {
    console.log(`  ${s.name}`.padEnd(58), String(s.tokens).padStart(8), `${((s.tokens / totalTokens) * 100).toFixed(1)}%`.padStart(9))
  }
  console.log('tools (agentTools, fuera del system)'.padEnd(58), String(toolsWeight).padStart(8), '(no cuenta al total del system)'.padStart(9))
  console.log('cached prefix (antes del anchor)'.padEnd(58), String(cachedPrefixTokens).padStart(8), `${((cachedPrefixTokens / totalTokens) * 100).toFixed(1)}%`.padStart(9))
  console.log('volatile tail (desde el anchor)'.padEnd(58), String(volatileTailTokens).padStart(8), `${((volatileTailTokens / totalTokens) * 100).toFixed(1)}%`.padStart(9))
  console.log('catálogo completo'.padEnd(58), String(catalogTokens).padStart(8), `${((catalogTokens / totalTokens) * 100).toFixed(1)}%`.padStart(9))
  console.log('catálogo solo-nombres (hipotético)'.padEnd(58), String(namesOnlyTokens).padStart(8), `${((namesOnlyTokens / totalTokens) * 100).toFixed(1)}%`.padStart(9))
  console.log('DELTA catálogo (ahorro potencial)'.padEnd(58), String(catalogDelta).padStart(8), `${((catalogDelta / totalTokens) * 100).toFixed(1)}%`.padStart(9))
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
