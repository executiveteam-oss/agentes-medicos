/**
 * NIVEL B — Snapshot del system prompt con regla auth_convenio activa.
 *
 * Verifica que la capa A funciona:
 * - CT marcado con [🛡 AUTORIZACIÓN: SOS, MEDPLUS, ...]
 * - Sección "REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS '🛡 AUTORIZACIÓN'"
 * - Paso 3.5 en el flujo de agendamiento
 * - CTs sin regla NO tienen marca
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-rule-auth-convenio-prompt-snapshot.ts
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
  console.log('  NIVEL B — Snapshot prompt: auth_convenio marcado')
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
  const ctColpo = makeCt('ct-colpo', 'Colposcopia')

  console.log('\n=== Test 1: SIN reglas (control) ===')
  const promptSin = buildSystemPrompt({
    clinic, doctor, doctors: [doctor],
    consultationTypes: [ctNoRule, ctColpo],
    patientPhone: '+573001234567', patientName: 'Test',
    existingPatient: null,
    authConveniosByCt: new Map(),
  })
  const lineasSin = promptSin.split('\n').filter(l => /^\s*\*\s/.test(l))
  const marcasSin = lineasSin.filter(l => l.includes('🛡')).length
  assert('Ningún listado tiene 🛡 cuando el Map está vacío',
    marcasSin === 0, `${marcasSin} marcas`)

  console.log('\n=== Test 2: CON regla activa para Colposcopia ===')
  const authMap = new Map<string, { convenios_que_requieren: string[]; message_pedir_archivo: string }>()
  authMap.set(ctColpo.id, {
    convenios_que_requieren: ['SOS', 'MEDPLUS', 'COLMÉDICA', 'AXA COLPATRIA'],
    message_pedir_archivo: 'Para {servicio} con {convenio} necesito autorización direccionada.',
  })
  const promptCon = buildSystemPrompt({
    clinic, doctor, doctors: [doctor],
    consultationTypes: [ctNoRule, ctColpo],
    patientPhone: '+573001234567', patientName: 'Test',
    existingPatient: null,
    authConveniosByCt: authMap,
  })

  const lineCtNoRule = promptCon.split('\n').find(l => l.includes('Consulta general'))
  assert('CT sin regla NO tiene marca 🛡',
    lineCtNoRule !== undefined && !lineCtNoRule.includes('🛡'),
    `línea: ${lineCtNoRule}`)

  const lineColpo = promptCon.split('\n').find(l => l.includes('Colposcopia'))
  assert('CT Colposcopia tiene "🛡 AUTORIZACIÓN"',
    lineColpo !== undefined && lineColpo.includes('🛡 AUTORIZACIÓN'),
    `línea: ${lineColpo}`)
  assert('Listado muestra los convenios (SOS, MEDPLUS, COLMÉDICA, AXA COLPATRIA)',
    lineColpo !== undefined && lineColpo.includes('SOS') && lineColpo.includes('MEDPLUS') && lineColpo.includes('COLMÉDICA') && lineColpo.includes('AXA COLPATRIA'))

  assert('Sección "REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS \\"🛡 AUTORIZACIÓN\\"" presente',
    promptCon.includes('REGLA INQUEBRANTABLE — TIPOS DE CONSULTA MARCADOS "🛡 AUTORIZACIÓN"'))
  assert('Paso 3.5 presente en el flujo',
    promptCon.includes('Paso 3.5'))
  assert('Sección menciona BLOCKED_BY_AUTH_PENDING',
    promptCon.includes('BLOCKED_BY_AUTH_PENDING'))
  assert('Sección menciona "📎 Autorización recibida"',
    promptCon.includes('Autorización recibida'))
  assert('Instrucciones explícitas de NO llamar create_appointment',
    promptCon.includes('NO llames create_appointment') || promptCon.includes('NO llames create_appointment') ||
    promptCon.includes('NO llamar create_appointment'))

  console.log('\n=== Listado del CT con regla (verificación visual) ===')
  for (const line of promptCon.split('\n')) {
    if (line.includes('Colposcopia') || line.includes('Consulta general')) console.log('  ' + line.trim())
  }

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main()
