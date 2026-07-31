/**
 * Snapshot — sección de MÉDICO TRATANTE en el system prompt por modo.
 * Run: TZ=America/Bogota npx tsx scripts/test-tratante-prompt-snapshot.ts
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
import type { Clinic, Doctor, ConsultationType } from '../src/types/database'
import type { ResolvedTratante } from '../src/lib/isalud/tratante-specialty'

let pass = 0, fail = 0
function assert(label: string, ok: boolean): void { if (ok) { console.log(`  ✅ ${label}`); pass++ } else { console.log(`  ❌ ${label}`); fail++ } }

const clinic = { id: 'c', name: 'Test', slug: 't', phone: '+57301', address: 'Calle 1', city: 'Pereira', department: 'Risaralda', specialty: ['Ginecología'], consultation_price: 100000, consultation_duration_minutes: 30, working_hours: {}, faq: [], agent_name: 'Asistente', agent_personality: 'profesional', welcome_message: null, subscription_status: 'active', subscription_plan: 'basic', trial_ends_at: null, feature_config: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', whatsapp_phone_id: null, whatsapp_token: null, whatsapp_config: null, payment_methods: null, cancellation_policy: null, location_url: null, escalation_contact_phone: null, whatsapp_business_account_id: null } as unknown as Clinic
const doctor = { id: 'd', clinic_id: 'c', name: 'Dr. Test', specialty: 'Ginecología', phone: null, email: null, is_active: true, working_hours: null, created_at: '2026-01-01T00:00:00Z' } as unknown as Doctor
const ct = { id: 'ct', clinic_id: 'c', doctor_id: 'd', name: 'Consulta', duration_minutes: 30, price: 100000, is_active: true, bookable_via_whatsapp: true, modality: 'presencial', eps_name: null, requires_preparation: false, preparation_instructions: null, requires_documents: false, required_documents_description: null, requires_free_text_reason: false, free_text_reason_prompt: null, insurer_type: null, insurer_type_set_by_staff: false, res256_category: null, eapb_code: null, non_bookable_message: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } as unknown as ConsultationType

const tratantes: ResolvedTratante[] = [
  { specialty: 'Ginecología', doctor_name: 'Juan Diego Villegas', doctor_id: 'D_JD' },
  { specialty: 'Fisioterapia', doctor_name: 'Lina Grajales', doctor_id: 'D_LINA' },
]
const base = { clinic, doctor, doctors: [doctor], consultationTypes: [ct], patientPhone: '+573001234567', patientName: 'Test', existingPatient: null, escalateHumanByCt: new Set<string>() }

console.log('Snapshot — sección médico tratante\n')

const pBlando = buildSystemPrompt({ ...base, tratanteMode: 'blando', tratantes })
assert('blando: aparece la sección', pBlando.includes('MÉDICO CON QUIEN YA SE HA ATENDIDO'))
assert('blando: lista Ginecología + Juan Diego', pBlando.includes('Ginecología: Juan Diego Villegas'))
assert('blando: lista Fisioterapia + Lina', pBlando.includes('Fisioterapia: Lina Grajales'))
assert('blando: wording "te has atendido con" (no "médico tratante")', pBlando.includes('te has atendido con el Dr./Dra.'))
assert('blando: prohíbe preguntar "¿quién es tu médico tratante?"', pBlando.includes('NUNCA preguntes "¿quién es tu médico tratante?"'))
assert('blando: NO usa la frase "tu médico tratante es"', !pBlando.includes('tu médico tratante es'))

const pOff = buildSystemPrompt({ ...base, tratanteMode: 'off', tratantes })
assert('off: NO aparece la sección', !pOff.includes('MÉDICO CON QUIEN YA SE HA ATENDIDO'))

const pEmpty = buildSystemPrompt({ ...base, tratanteMode: 'blando', tratantes: [] })
assert('blando sin tratantes: NO aparece la sección', !pEmpty.includes('MÉDICO CON QUIEN YA SE HA ATENDIDO'))

console.log(`\nResultado: ${pass} ✅ / ${fail} ❌`)
process.exit(fail === 0 ? 0 : 1)
