/**
 * NIVEL B — Snapshot del system prompt con regla patient_condition activa.
 *
 * Verifica que la capa A funciona:
 * - CT con preguntas activas tiene marca 🩺 PREGUNTAR (N)
 * - Listado debajo del CT con cada rule_id, pregunta, trigger y action
 * - Sección "REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS '🩺 PREGUNTAR'" presente
 * - CTs sin regla NO tienen la marca
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-rule-patient-condition-prompt-snapshot.ts
 */

if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}

import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  const c = readFileSync(p, 'utf-8')
  for (const line of c.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
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

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  NIVEL B — Snapshot system prompt: patient_condition marcado')
  console.log('═══════════════════════════════════════════════════════════════')

  const clinic = {
    id: 'test-clinic', name: 'Test Clinic', slug: 'test',
    phone: '+57301234567', address: 'Calle 1', city: 'Pereira',
    department: 'Risaralda', specialty: ['Ginecología'],
    consultation_price: 100000, consultation_duration_minutes: 30,
    working_hours: {} as never, faq: [], agent_name: 'Asistente',
    agent_personality: 'profesional', welcome_message: null,
    subscription_status: 'active', subscription_plan: 'basic',
    trial_ends_at: null, feature_config: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    whatsapp_phone_id: null, whatsapp_token: null,
    whatsapp_config: null, payment_methods: null,
    cancellation_policy: null, location_url: null,
    escalation_contact_phone: null, whatsapp_business_account_id: null,
  } as unknown as Clinic

  const doctor = {
    id: 'test-doc', clinic_id: 'test-clinic', name: 'Dr. Test',
    specialty: 'Ginecología', phone: null, email: null, is_active: true,
    working_hours: null, created_at: new Date().toISOString(),
  } as unknown as Doctor

  function makeCt(id: string, name: string): ConsultationType {
    return {
      id, clinic_id: 'test-clinic', doctor_id: 'test-doc', name,
      duration_minutes: 30, price: 100000, is_active: true,
      bookable_via_whatsapp: true, modality: 'presencial',
      eps_name: null, requires_preparation: false,
      preparation_instructions: null, requires_documents: false,
      required_documents_description: null, requires_free_text_reason: false,
      free_text_reason_prompt: null, insurer_type: null,
      insurer_type_set_by_staff: false, res256_category: null,
      eapb_code: null, non_bookable_message: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as unknown as ConsultationType
  }

  const ctNoRule = makeCt('ct-normal', 'Consulta general')
  const ctConPregunta = makeCt('ct-mapeo', 'Mapeo cardiológico')

  console.log('\n=== Test 1: SIN reglas (control) ===')
  const promptSinReglas = buildSystemPrompt({
    clinic, doctor, doctors: [doctor],
    consultationTypes: [ctNoRule, ctConPregunta],
    patientPhone: '+573001234567', patientName: 'Test',
    existingPatient: null,
    patientConditionsByCt: new Map(),
  })
  const lineas = promptSinReglas.split('\n').filter(l => /^\s*\*\s/.test(l))
  const marcasSin = lineas.filter(l => l.includes('🩺')).length
  assert('Ningún listado tiene 🩺 cuando el Map está vacío',
    marcasSin === 0, `${marcasSin} líneas`)

  console.log('\n=== Test 2: CON 2 preguntas para CT Mapeo ===')
  const conditionsMap = new Map()
  conditionsMap.set(ctConPregunta.id, [
    {
      rule_id: 'rule-gestantes-id',
      question: '¿Estás embarazada actualmente?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
    },
    {
      rule_id: 'rule-ayuno-id',
      question: '¿Has cumplido 8 horas de ayuno?',
      trigger_answer: 'no',
      action_on_trigger: 'rechazar',
    },
  ])

  const promptConReglas = buildSystemPrompt({
    clinic, doctor, doctors: [doctor],
    consultationTypes: [ctNoRule, ctConPregunta],
    patientPhone: '+573001234567', patientName: 'Test',
    existingPatient: null,
    patientConditionsByCt: conditionsMap,
  })

  const lineCtNoRule = promptConReglas.split('\n').find(l => l.includes('Consulta general'))
  assert('CT sin regla NO tiene marca 🩺',
    lineCtNoRule !== undefined && !lineCtNoRule.includes('🩺'),
    `línea: ${lineCtNoRule}`)

  const lineMapeo = promptConReglas.split('\n').find(l => l.includes('Mapeo cardiológico'))
  assert('CT con preguntas tiene "🩺 PREGUNTAR (2)"',
    lineMapeo !== undefined && lineMapeo.includes('🩺 PREGUNTAR (2)'),
    `línea: ${lineMapeo}`)

  assert('Prompt contiene "rule_id: rule-gestantes-id"',
    promptConReglas.includes('rule_id: rule-gestantes-id'))
  assert('Prompt contiene "¿Estás embarazada actualmente?"',
    promptConReglas.includes('¿Estás embarazada actualmente?'))
  assert('Prompt contiene "rule_id: rule-ayuno-id"',
    promptConReglas.includes('rule_id: rule-ayuno-id'))
  assert('Prompt contiene "dispara si responde"',
    promptConReglas.includes('dispara si responde'))

  assert('Sección "REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS \\"🩺 PREGUNTAR\\"" presente',
    promptConReglas.includes('REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS "🩺 PREGUNTAR"'))
  assert('Sección menciona patient_condition_answers',
    promptConReglas.includes('patient_condition_answers'))
  assert('Sección menciona "yes/no/ambiguous"',
    promptConReglas.includes('"yes"') && promptConReglas.includes('"no"') && promptConReglas.includes('"ambiguous"'))
  assert('Sección menciona BLOCKED_CONDITION_NOT_ASKED',
    promptConReglas.includes('BLOCKED_CONDITION_NOT_ASKED'))

  console.log('\n=== Listado del CT con preguntas (verificación visual) ===')
  const lines = promptConReglas.split('\n')
  let inside = false
  for (const line of lines) {
    if (line.includes('Mapeo cardiológico')) inside = true
    if (inside) {
      console.log('  ' + line)
      if (line.includes('rule_id:')) {
        // continue printing rule lines
        continue
      }
      if (inside && !line.includes('Mapeo') && !line.includes('rule_id') && !line.includes('Preguntas')) {
        inside = false
      }
    }
  }

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main()
