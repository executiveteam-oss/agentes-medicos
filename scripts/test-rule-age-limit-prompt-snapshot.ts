/**
 * NIVEL B — Snapshot del system prompt con regla age_limit activa.
 *
 * Verifica que la capa A (inyección en el prompt) funciona:
 * - CT con solo min → marca "👶 EDAD: 15+ años"
 * - CT con rango → marca "👶 EDAD: 18-50 años"
 * - CT con solo max → marca "👶 EDAD: ≤12 años"
 * - Sección "REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS '👶 EDAD'" presente
 * - CTs sin regla NO tienen la marca
 *
 * NO usa LLM. Solo construye el prompt y hace string matching.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-rule-age-limit-prompt-snapshot.ts
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

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  NIVEL B — Snapshot system prompt: age_limit marcado')
  console.log('═══════════════════════════════════════════════════════════════')

  // Fixtures mínimos
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
  const ctSoloMin = makeCt('ct-solo-min', 'Consulta ginecológica')   // solo min=15
  const ctRango = makeCt('ct-rango', 'Mapeo cardiológico')           // 18-50
  const ctSoloMax = makeCt('ct-solo-max', 'Consulta pediátrica')     // solo max=12

  console.log('\n=== Test 1: SIN reglas (control) ===')
  const promptSinReglas = buildSystemPrompt({
    clinic, doctor, doctors: [doctor],
    consultationTypes: [ctNoRule, ctSoloMin, ctRango, ctSoloMax],
    patientPhone: '+573001234567', patientName: 'Test',
    existingPatient: null,
    escalateHumanByCt: new Set<string>(),
    ageLimitsByCt: new Map(),
  })
  const listadoSinReglas = promptSinReglas.split('\n').filter(l => /^\s*\*\s/.test(l))
  const marcasEdadSinReglas = listadoSinReglas.filter(l => l.includes('👶')).length
  assert('Ningún listado tiene 👶 cuando el Map está vacío',
    marcasEdadSinReglas === 0, `${marcasEdadSinReglas} líneas con 👶`)

  console.log('\n=== Test 2: CON reglas (3 CTs marcados, 1 sin marca) ===')
  const ageLimitsByCt = new Map<string, { min?: number; max?: number; action_below_min?: 'rechazar' | 'derivar_humano'; action_above_max?: 'rechazar' | 'derivar_humano' }>()
  ageLimitsByCt.set(ctSoloMin.id, { min: 15, action_below_min: 'rechazar' })
  ageLimitsByCt.set(ctRango.id, {
    min: 18, max: 50,
    action_below_min: 'rechazar', action_above_max: 'derivar_humano',
  })
  ageLimitsByCt.set(ctSoloMax.id, { max: 12, action_above_max: 'rechazar' })

  const promptConReglas = buildSystemPrompt({
    clinic, doctor, doctors: [doctor],
    consultationTypes: [ctNoRule, ctSoloMin, ctRango, ctSoloMax],
    patientPhone: '+573001234567', patientName: 'Test',
    existingPatient: null,
    escalateHumanByCt: new Set<string>(),
    ageLimitsByCt,
  })

  // CT sin regla: no debe tener 👶
  const lineCtNoRule = promptConReglas.split('\n').find(l => l.includes('Consulta general'))
  assert('CT sin regla NO tiene marca 👶',
    lineCtNoRule !== undefined && !lineCtNoRule.includes('👶'),
    `línea: ${lineCtNoRule}`)

  // CT solo-min: marca "👶 EDAD: 15+ años"
  const lineSoloMin = promptConReglas.split('\n').find(l => l.includes('Consulta ginecológica'))
  assert('CT solo-min tiene "👶 EDAD: 15+ años"',
    lineSoloMin !== undefined && lineSoloMin.includes('👶 EDAD: 15+ años'),
    `línea: ${lineSoloMin}`)

  // CT rango: marca "👶 EDAD: 18-50 años"
  const lineRango = promptConReglas.split('\n').find(l => l.includes('Mapeo cardiológico'))
  assert('CT rango tiene "👶 EDAD: 18-50 años"',
    lineRango !== undefined && lineRango.includes('👶 EDAD: 18-50 años'),
    `línea: ${lineRango}`)

  // CT solo-max: marca "👶 EDAD: ≤12 años"
  const lineSoloMax = promptConReglas.split('\n').find(l => l.includes('Consulta pediátrica'))
  assert('CT solo-max tiene "👶 EDAD: ≤12 años"',
    lineSoloMax !== undefined && lineSoloMax.includes('👶 EDAD: ≤12 años'),
    `línea: ${lineSoloMax}`)

  // Sección REGLA INQUEBRANTABLE — EDAD presente
  assert('Sección "REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS \\"👶 EDAD\\"" presente',
    promptConReglas.includes('REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS "👶 EDAD"'))

  // Menciones clave
  assert('Sección menciona "fecha de nacimiento"',
    promptConReglas.includes('fecha de nacimiento'))
  assert('Sección menciona "calcular la edad" o equivalente',
    /calcul[áa] (mentalmente |)la edad|Calcul[áa] la edad/i.test(promptConReglas))
  assert('Sección menciona "escalate_to_human" para edge case sin DOB',
    promptConReglas.includes('escalate_to_human'))

  // Mostrar fragmento para verificación visual
  console.log('\n=== Listado de tipos con marcas (verificación visual) ===')
  for (const line of promptConReglas.split('\n')) {
    if (line.includes('Consulta general') || line.includes('Consulta ginecológica') ||
        line.includes('Mapeo cardiológico') || line.includes('Consulta pediátrica')) {
      console.log('  ' + line.trim())
    }
  }

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main()
