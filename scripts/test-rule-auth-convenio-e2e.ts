/**
 * NIVEL A — Test E2E del check duro del bloque 4 (requires_authorization).
 *
 * Cubre los 4 escenarios principales:
 *   1. Sin patient_eps → success (regla no aplica)
 *   2. patient_eps NO matchea la lista → success (paciente apto)
 *   3. patient_eps SÍ matchea → BLOCKED_BY_AUTH_PENDING + audit log
 *   4. Variante ortográfica del convenio ("Colmedica" matchea "COLMÉDICA")
 *      → BLOCKED_BY_AUTH_PENDING (normalizer funciona)
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-rule-auth-convenio-e2e.ts
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

import { createClient } from '@supabase/supabase-js'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const TEST_CT_NAME = '__TEST_AUTH_CONVENIO_RULE__'
const TEST_PATIENT_PHONE = '+573999000004'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  NIVEL A — Test E2E check duro requires_authorization')
  console.log('═══════════════════════════════════════════════════════════════')

  const { data: docRow } = await supa.from('doctors').select('id, name')
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true).limit(1).single()
  if (!docRow) { console.error('FATAL'); process.exit(1) }
  console.log(`\nDoctor: ${docRow.name}`)

  // Cleanup
  console.log('\n=== Step 1: Cleanup ===')
  const { data: oldCts } = await supa.from('consultation_types').select('id')
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('name', TEST_CT_NAME)
  for (const oldCt of oldCts ?? []) {
    await supa.from('consultation_type_rules').delete().eq('consultation_type_id', oldCt.id)
    await supa.from('appointments').delete().eq('consultation_type_id', oldCt.id)
    await supa.from('consultation_types').delete().eq('id', oldCt.id)
  }
  await supa.from('audit_log').delete()
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('action', 'create_appointment_blocked_by_rule')
    .filter('details->>patient_phone', 'eq', TEST_PATIENT_PHONE)
  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', TEST_PATIENT_PHONE)
  console.log('  OK')

  // CT de prueba
  const { data: ct } = await supa.from('consultation_types').insert({
    clinic_id: ALGIA_CLINIC_ID,
    doctor_id: docRow.id,
    name: TEST_CT_NAME,
    duration_minutes: 30,
    price: 100000,
    is_active: true,
    bookable_via_whatsapp: true,
    modality: 'presencial',
    eps_name: null,
  }).select('id').single()
  if (!ct) { process.exit(1) }

  // Regla activa: SOS, MEDPLUS, COLMÉDICA, AXA COLPATRIA requieren auth
  const { data: rule } = await supa.from('consultation_type_rules').insert({
    consultation_type_id: ct.id,
    clinic_id: ALGIA_CLINIC_ID,
    rule_type: 'requires_authorization',
    condition_config: {
      convenios_que_requieren: ['SOS', 'MEDPLUS', 'COLMÉDICA', 'AXA COLPATRIA'],
      message_pedir_archivo: 'Para {servicio} con {convenio} necesito autorización direccionada. Mandala por aquí.',
      match_mode: 'normalized_name',
    },
    action: 'derivar_humano',
    message: null,
    active: true,
  }).select('id').single()
  if (!rule) { process.exit(1) }
  console.log(`  Regla creada: ${rule.id}`)

  // Setup ejecución
  const { executeTool } = await import('../src/agents/tools/executor')
  const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
  const { data: doctorRow } = await supa.from('doctors').select('*').eq('id', docRow.id).single()
  if (!clinicRow || !doctorRow) { process.exit(1) }

  const future = new Date()
  future.setDate(future.getDate() + 16)
  future.setHours(23, 45, 0, 0)
  const startsAt = future.toISOString()

  function baseInput(eps: string | null): Record<string, unknown> {
    const input: Record<string, unknown> = {
      doctor_id: docRow!.id,
      patient_name: 'Paciente Test Auth',
      patient_phone: TEST_PATIENT_PHONE,
      starts_at: startsAt,
      consultation_type_id: ct!.id,
      date_of_birth: '1990-01-01',
      document_type: 'CC',
      document_number: '99900004',
    }
    if (eps) input.patient_eps = eps
    return input
  }

  // ---- Caso 1: sin patient_eps → success ----
  console.log('\n=== Caso 1: sin patient_eps (particular) ===')
  const r1 = await executeTool('create_appointment', baseInput(null), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=true (regla no aplica sin convenio)', r1.success === true, `error=${r1.error}`)
  await supa.from('appointments').delete()
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('consultation_type_id', ct.id)
  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', TEST_PATIENT_PHONE)

  // ---- Caso 2: Allianz (NO en lista) → success ----
  console.log('\n=== Caso 2: patient_eps="Allianz" (NO en lista) ===')
  const r2 = await executeTool('create_appointment', baseInput('Allianz'), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=true (Allianz no matchea)', r2.success === true, `error=${r2.error}`)
  await supa.from('appointments').delete()
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('consultation_type_id', ct.id)
  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', TEST_PATIENT_PHONE)

  // ---- Caso 3: SOS → bloqueado ----
  console.log('\n=== Caso 3: patient_eps="SOS" (matchea directo) ===')
  const r3 = await executeTool('create_appointment', baseInput('SOS'), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false', r3.success === false)
  assert('error=BLOCKED_BY_AUTH_PENDING', r3.error === 'BLOCKED_BY_AUTH_PENDING', `recibí ${r3.error}`)
  const d3 = (r3.data ?? {}) as Record<string, unknown>
  assert('must_escalate=true', d3.must_escalate === true)
  assert('outcome=authorization_required', d3.outcome === 'authorization_required')
  assert('message_for_patient menciona "SOS"',
    typeof d3.message_for_patient === 'string' && (d3.message_for_patient as string).includes('SOS'))
  assert('message_for_patient menciona el nombre del servicio',
    typeof d3.message_for_patient === 'string' && (d3.message_for_patient as string).includes(TEST_CT_NAME))

  // ---- Caso 4: variante "Colmedica" (sin tilde) → matchea COLMÉDICA ----
  console.log('\n=== Caso 4: patient_eps="Colmedica medicina prepagada" (variante) ===')
  const r4 = await executeTool('create_appointment',
    baseInput('Colmedica medicina prepagada SA'),
    ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false (matcheó variante)', r4.success === false)
  assert('error=BLOCKED_BY_AUTH_PENDING', r4.error === 'BLOCKED_BY_AUTH_PENDING', `recibí ${r4.error}`)

  // ---- Audit ----
  console.log('\n=== Audit log: 2 entries esperadas (caso 3 y 4) ===')
  const { data: audits } = await supa.from('audit_log')
    .select('details')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('action', 'create_appointment_blocked_by_rule')
    .eq('target_id', ct.id)
  assert('2 audit logs', (audits ?? []).length === 2, `recibí ${audits?.length}`)
  if (audits && audits.length >= 1) {
    const d = audits[0].details as Record<string, unknown>
    assert('audit menciona patient_eps_declared',
      typeof d.patient_eps_declared === 'string' && (d.patient_eps_declared as string).length > 0)
    assert('audit menciona convenios_configured',
      Array.isArray(d.convenios_configured))
  }

  // Cleanup
  console.log('\n=== Cleanup ===')
  await supa.from('audit_log').delete().eq('target_id', ct.id).eq('action', 'create_appointment_blocked_by_rule')
  await supa.from('consultation_type_rules').delete().eq('consultation_type_id', ct.id)
  await supa.from('consultation_types').delete().eq('id', ct.id)
  console.log('  OK')

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
