/**
 * Regresión (B1, 2026-07-30): el catálogo del system prompt NO debe inyectar
 * NINGÚN precio — ni de CTs particulares ni de CTs de convenio (eps_name !=
 * null). El único camino a un precio es el tool get_consultation_price
 * (regla en código, Task 1/2). El NOMBRE del convenio SÍ se conserva (el
 * agente lo usa para elegir el tipo_id al agendar).
 *
 * Historial: hasta B1, un fix anterior ("fix A") inyectaba el precio SOLO
 * para CTs particulares. B1 lo saca también para esos — cero precios en el
 * catálogo, sin excepción.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-catalog-no-convenio-price.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }

import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local'); loadEnvFile('.env.local')

import { buildSystemPrompt } from '../src/agents/prompts/system-prompt'
import type { Clinic, ConsultationType, Doctor } from '../src/types/database'

let passed = 0, failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

const clinic = {
  id: 'test-clinic', name: 'Test Clinic', slug: 'test', phone: '+57301234567',
  address: 'Calle 1', city: 'Pereira', department: 'Risaralda', specialty: ['Ginecología'],
  consultation_price: 100000, consultation_duration_minutes: 30, working_hours: {} as never,
  faq: [], agent_name: 'Asistente', agent_personality: 'profesional', welcome_message: null,
  subscription_status: 'active', subscription_plan: 'basic', trial_ends_at: null, feature_config: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  whatsapp_phone_id: null, whatsapp_token: null, whatsapp_config: null, payment_methods: null,
  cancellation_policy: null, location_url: null, escalation_contact_phone: null, whatsapp_business_account_id: null,
} as unknown as Clinic

const doctor = {
  id: 'test-doc', clinic_id: 'test-clinic', name: 'Dr. Test', specialty: 'Ginecología',
  phone: null, email: null, is_active: true, working_hours: null, created_at: new Date().toISOString(),
} as unknown as Doctor

function makeCt(id: string, name: string, price: number, eps_name: string | null): ConsultationType {
  return {
    id, clinic_id: 'test-clinic', doctor_id: 'test-doc', name, duration_minutes: 30, price,
    is_active: true, bookable_via_whatsapp: true, modality: 'presencial', eps_name,
    requires_preparation: false, preparation_instructions: null, requires_documents: false,
    required_documents_description: null, requires_free_text_reason: false, free_text_reason_prompt: null,
    insurer_type: eps_name ? 'Prepagada' : null, insurer_type_set_by_staff: false, res256_category: null,
    eapb_code: null, non_bookable_message: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } as unknown as ConsultationType
}

const ctParticular = makeCt('ct-part', 'Ecografia de Mapeo Pelvico', 264720, null)
const ctConvenio = makeCt('ct-conv', 'Colposcopia', 250000, 'COOMEVA MEDICINA PREPAGADA SA')

const prompt = buildSystemPrompt({
  clinic, doctor, doctors: [doctor],
  consultationTypes: [ctParticular, ctConvenio],
  patientPhone: '+573001234567', patientName: 'Test', existingPatient: null,
})

const lineaParticular = prompt.split('\n').find((l) => l.includes('tipo_id: ct-part')) ?? ''
const lineaConvenio = prompt.split('\n').find((l) => l.includes('tipo_id: ct-conv')) ?? ''
const lineasCatalogo = prompt.split('\n').filter((l) => l.includes('tipo_id:'))

console.log('B1 — cero precios en el catálogo (ni particular ni convenio)\n')
console.log('  particular:', lineaParticular.trim())
console.log('  convenio  :', lineaConvenio.trim(), '\n')

// B1: NINGÚN precio en el catálogo, ni siquiera el particular (antes sí lo mostraba — fix A superado)
assert('particular ya NO muestra su precio ($264.720)', !lineaParticular.includes('264.720'))
// Convenio: NO precio (confidencial), en NINGUNA parte del prompt
assert('convenio NO muestra su tarifa ($250.000) en su línea', !lineaConvenio.includes('250.000'))
assert('la tarifa de convenio ($250.000) NO está en NINGÚN lugar del prompt', !prompt.includes('250.000'))
assert('la tarifa particular ($264.720) NO está en NINGÚN lugar del prompt', !prompt.includes('264.720'))
// Ninguna línea de catálogo (tipo_id:) debe traer signo de tarifa en COP ($ seguido de dígitos)
assert(
  'ninguna línea del catálogo de CTs contiene un precio ($ + dígitos)',
  lineasCatalogo.every((l) => !/\$\d/.test(l)),
  lineasCatalogo.find((l) => /\$\d/.test(l))?.trim(),
)
// Convenio: nombre conservado para elegir tipo_id
assert('convenio conserva el nombre [COOMEVA...] para el tipo_id', lineaConvenio.includes('COOMEVA'))
assert('la línea de convenio conserva su tipo_id', lineaConvenio.includes('tipo_id: ct-conv'))

console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
process.exit(failed === 0 ? 0 : 1)
