/**
 * NIVEL B — Snapshot del system prompt con regla escalate_human activa.
 *
 * Verifica que la capa A (inyección en el prompt) funciona:
 * - Cuando un consultation_type tiene regla escalate_human activa,
 *   aparece marcado con 🚨 ESCALAR SIEMPRE en el listado.
 * - La sección "REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS"
 *   está presente en el prompt.
 *
 * NO usa LLM. Solo construye el prompt y hace string matching.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-rule-prompt-snapshot.ts
 */

if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}

import { existsSync, readFileSync } from 'fs'

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  const c = readFileSync(path, 'utf-8')
  for (const line of c.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')
loadEnvFile('.env.local')

import { buildSystemPrompt } from '../src/agents/prompts/system-prompt'
import type { Clinic, ConsultationType, Doctor } from '../src/types/database'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  NIVEL B — Snapshot system prompt: escalate_human marcado')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')

  // Fixtures mínimas
  const clinic: Clinic = {
    id: 'test-clinic',
    name: 'Test Clinic',
    slug: 'test',
    phone: '+57301234567',
    address: 'Calle 1',
    city: 'Pereira',
    department: 'Risaralda',
    specialty: ['Ginecología'],
    consultation_price: 100000,
    consultation_duration_minutes: 30,
    working_hours: {} as never,
    faq: [],
    agent_name: 'Asistente',
    agent_personality: 'profesional',
    welcome_message: null,
    subscription_status: 'active',
    subscription_plan: 'basic',
    trial_ends_at: null,
    feature_config: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    whatsapp_phone_id: null,
    whatsapp_token: null,
    whatsapp_config: null,
    payment_methods: null,
    cancellation_policy: null,
    location_url: null,
    escalation_contact_phone: null,
    whatsapp_business_account_id: null,
  } as unknown as Clinic

  const doctor: Doctor = {
    id: 'test-doc',
    clinic_id: 'test-clinic',
    name: 'Dr. Test',
    specialty: 'Ginecología',
    phone: null,
    email: null,
    is_active: true,
    working_hours: null,
    created_at: new Date().toISOString(),
  } as unknown as Doctor

  const ctNormal: ConsultationType = {
    id: 'ct-normal',
    clinic_id: 'test-clinic',
    doctor_id: 'test-doc',
    name: 'Consulta de ginecología',
    duration_minutes: 30,
    price: 100000,
    is_active: true,
    bookable_via_whatsapp: true,
    modality: 'presencial',
    eps_name: null,
    requires_preparation: false,
    preparation_instructions: null,
    requires_documents: false,
    required_documents_description: null,
    requires_free_text_reason: false,
    free_text_reason_prompt: null,
    insurer_type: null,
    insurer_type_set_by_staff: false,
    res256_category: null,
    eapb_code: null,
    non_bookable_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as ConsultationType

  const ctEscalate: ConsultationType = {
    ...ctNormal,
    id: 'ct-escalate',
    name: 'Histeroscopia diagnóstica',
  } as ConsultationType

  // --- Test 1: SIN regla activa → no aparece marca ---
  console.log('=== Test 1: SIN regla activa (control) ===')
  const promptSinRegla = buildSystemPrompt({
    clinic,
    doctor,
    doctors: [doctor],
    consultationTypes: [ctNormal, ctEscalate],
    patientPhone: '+573001234567',
    patientName: 'Test Patient',
    existingPatient: null,
    escalateHumanByCt: new Set<string>(),  // vacío — sin reglas
  })

  // La marca 🚨 ESCALAR SIEMPRE SIEMPRE aparece en el prompt como parte de la
  // sección explicativa de la regla (el LLM necesita saber qué buscar). Lo que
  // varía con el Set es si aparece en LAS LÍNEAS DEL LISTADO de tipos.
  const lineasListadoSinRegla = promptSinRegla.split('\n').filter(l => /^\s*\*\s/.test(l))
  const marcasEnListadoSinRegla = lineasListadoSinRegla.filter(l => l.includes('🚨')).length
  assert(
    'NINGUNA línea del listado tiene 🚨 cuando el Set está vacío',
    marcasEnListadoSinRegla === 0,
    `${marcasEnListadoSinRegla} líneas con 🚨`,
  )

  // --- Test 2: CON regla activa para Histeroscopia → aparece marca ---
  console.log('\n=== Test 2: CON regla activa para Histeroscopia ===')
  const promptConRegla = buildSystemPrompt({
    clinic,
    doctor,
    doctors: [doctor],
    consultationTypes: [ctNormal, ctEscalate],
    patientPhone: '+573001234567',
    patientName: 'Test Patient',
    existingPatient: null,
    escalateHumanByCt: new Set([ctEscalate.id]),  // solo Histeroscopia
  })

  assert(
    'Aparece marca "🚨 ESCALAR SIEMPRE" en el listado',
    promptConRegla.includes('🚨 ESCALAR SIEMPRE'),
  )

  // Debe aparecer una sola vez (no en el CT normal)
  const matches = (promptConRegla.match(/🚨 ESCALAR SIEMPRE/g) ?? []).length
  // Cuento solo las marcas inline en el listado (la sección de regla menciona la marca varias veces)
  const inlineMarkPattern = /\* Histeroscopia diagnóstica.*🚨 ESCALAR SIEMPRE/
  assert(
    'La marca aparece junto al nombre de Histeroscopia (no junto a Consulta ginecología)',
    inlineMarkPattern.test(promptConRegla),
  )

  // Verificar que NO está marcado el otro CT
  const consultaLine = promptConRegla.split('\n').find(l => l.includes('Consulta de ginecología'))
  assert(
    'CT sin regla NO tiene la marca',
    consultaLine !== undefined && !consultaLine.includes('🚨'),
    `línea: ${consultaLine}`,
  )

  // Verificar que aparece la sección REGLA INQUEBRANTABLE en el prompt
  assert(
    'Sección "REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS" presente',
    promptConRegla.includes('REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS'),
  )

  assert(
    'Sección menciona "NO llames create_appointment"',
    promptConRegla.includes('NO llames create_appointment'),
  )

  assert(
    'Sección menciona escalate_to_human',
    promptConRegla.includes('escalate_to_human'),
  )

  // --- Mostrar fragmento del prompt para visualizar ---
  console.log('\n=== Fragmento del prompt con regla activa (verificación visual) ===')
  const startIdx = promptConRegla.indexOf('REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS')
  if (startIdx >= 0) {
    const endIdx = promptConRegla.indexOf('REGLA CRÍTICA — TRES CATEGORÍAS DE PAGO', startIdx)
    console.log('─────────────────────────────────────────────────────────')
    console.log(promptConRegla.slice(startIdx, endIdx))
    console.log('─────────────────────────────────────────────────────────')
  }

  console.log('\n=== Listado de tipos en el prompt (verificación visual) ===')
  const lines = promptConRegla.split('\n')
  for (const line of lines) {
    if (line.includes('Consulta de ginecología') || line.includes('Histeroscopia')) {
      console.log('  ' + line.trim())
    }
  }

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
