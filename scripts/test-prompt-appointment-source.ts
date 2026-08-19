/**
 * Commit B — el system prompt trae: (1) fuente única de citas (tool gana al
 * historial, atada al HECHO no a la pregunta), (2) año en confirmaciones,
 * (3) cláusula anti-eco reforzada (timestamp en TODOS los mensajes).
 *
 * NO usa LLM. Construye el prompt y hace string matching.
 * Run: TZ=America/Bogota npx tsx scripts/test-prompt-appointment-source.ts
 */
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string, string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function loadEnv(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv('.env.production.local'); loadEnv('.env.local')

import { buildSystemPrompt } from '../src/agents/prompts/system-prompt'
import type { Clinic, ConsultationType, Doctor } from '../src/types/database'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void {
  if (ok) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label}`); fail++ }
}

const clinic = {
  id: 'c', name: 'Test', slug: 't', phone: '+57301', address: 'Calle 1', city: 'Pereira',
  department: 'Risaralda', specialty: ['Ginecología'], consultation_price: 100000,
  consultation_duration_minutes: 30, working_hours: {}, faq: [], agent_name: 'Asistente',
  agent_personality: 'profesional', welcome_message: null, subscription_status: 'active',
  subscription_plan: 'basic', trial_ends_at: null, feature_config: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', whatsapp_phone_id: null,
  whatsapp_token: null, whatsapp_config: null, payment_methods: null, cancellation_policy: null,
  location_url: null, escalation_contact_phone: null, whatsapp_business_account_id: null,
} as unknown as Clinic
const doctor = {
  id: 'd', clinic_id: 'c', name: 'Dr. Test', specialty: 'Ginecología', phone: null, email: null,
  is_active: true, working_hours: null, created_at: '2026-01-01T00:00:00Z',
} as unknown as Doctor
const ct = {
  id: 'ct', clinic_id: 'c', doctor_id: 'd', name: 'Consulta', duration_minutes: 30, price: 100000,
  is_active: true, bookable_via_whatsapp: true, modality: 'presencial', eps_name: null,
  requires_preparation: false, preparation_instructions: null, requires_documents: false,
  required_documents_description: null, requires_free_text_reason: false, free_text_reason_prompt: null,
  insurer_type: null, insurer_type_set_by_staff: false, res256_category: null, eapb_code: null,
  non_bookable_message: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
} as unknown as ConsultationType

const prompt = buildSystemPrompt({
  clinic, doctor, doctors: [doctor], consultationTypes: [ct],
  patientPhone: '+573001234567', patientName: 'Test', existingPatient: null,
  escalateHumanByCt: new Set<string>(),
})

console.log('Commit B — prompt: fuente única de citas + año + anti-eco\n')

// (1) Fuente única — atada al hecho + tool gana al historial
assert('regla usa get_patient_appointments', prompt.includes('get_patient_appointments(patient_phone)'))
assert('atada al HECHO: "la pregunte ella o la menciones vos"', /la pregunte ella o la menciones vos/i.test(prompt))
assert('tool GANA contra el historial', prompt.includes('El tool GANA contra el historial'))
// La regla decía "si devuelve vacío, la paciente NO tiene citas programadas y así
// se lo decís —aunque ella insista". Eso convertía un no-encuentro en certeza y
// hacía que el agente le discutiera a la paciente: el 18/08 le dijo "no tengo
// registrada una cita tuya" a una con TRES citas al día siguiente. El tool sigue
// ganando para AFIRMAR; lo que cambia es qué hacer con el vacío.
assert('el tool gana sólo para AFIRMAR', /GANA contra el historial PARA AFIRMAR/i.test(prompt))
assert('un vacío NO es certeza', /VAC[ÍI]O no es una certeza/i.test(prompt))
assert('si ella insiste → escalar, no contradecir', /NO la contradigas[\s\S]*escalate_to_human/i.test(prompt))
assert('prohíbe afirmar desde historial/memoria', /NUNCA afirmes nada sobre una cita leyéndolo del historial ni de memoria/i.test(prompt))

// (2) Año en confirmaciones
assert('plantilla de confirmación pide AÑO', prompt.includes('fecha CON AÑO'))
assert('ejemplo de confirmación con año (de 2026)', prompt.includes('Martes 18 de marzo de 2026'))

// (3) Anti-eco reforzada
assert('corchete = METADATA INTERNA', prompt.includes('METADATA INTERNA'))
assert('cubre mensajes del agente y paciente', /CADA mensaje del historial[\s\S]*tuyos y los de la paciente/i.test(prompt))
assert('prohíbe empezar respuestas con corchete', /JAMÁS empiezan con un corchete/i.test(prompt))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
