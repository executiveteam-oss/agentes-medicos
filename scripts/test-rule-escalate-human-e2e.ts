/**
 * NIVEL A — Test E2E del check duro del bloque 1.
 *
 * Verifica que la capa B (check en executor.create_appointment) bloquea
 * físicamente el agendamiento cuando un consultation_type tiene regla
 * escalate_human activa, sin importar lo que diga el LLM.
 *
 * Flujo:
 *   1. Cleanup previo (por si quedó data de un run anterior)
 *   2. Crear consultation_type de prueba en Algia
 *   3. Insertar regla escalate_human activa
 *   4. Llamar internamente createAppointment con ese CT
 *   5. Asertar:
 *      - Devuelve { success: false, error: 'BLOCKED_BY_RULE_ESCALATE_HUMAN' }
 *      - El data trae must_escalate=true y escalate_reason
 *      - NO se creó fila en appointments
 *      - SÍ se creó fila en audit_log con action='create_appointment_blocked_by_rule'
 *   6. Cleanup
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-rule-escalate-human-e2e.ts
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

import { createClient } from '@supabase/supabase-js'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const TEST_CT_NAME = '__TEST_ESCALATE_RULE__'
const TEST_PATIENT_PHONE = '+573999000001'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  NIVEL A — Test E2E check duro escalate_human')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')

  // --- Step 0: pick a real doctor from Algia ---
  const { data: docRow } = await supa
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!docRow) {
    console.error('FATAL: no hay doctores activos en Algia')
    process.exit(1)
  }
  const doctorId = docRow.id
  console.log(`Doctor de prueba: ${docRow.name} (${doctorId})`)

  // --- Step 1: cleanup previo ---
  console.log('\n=== Step 1: Cleanup previo ===')
  const { data: oldCts } = await supa
    .from('consultation_types')
    .select('id')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('name', TEST_CT_NAME)
  for (const oldCt of oldCts ?? []) {
    await supa.from('consultation_type_rules').delete().eq('consultation_type_id', oldCt.id)
    await supa.from('appointments').delete().eq('consultation_type_id', oldCt.id)
    await supa.from('consultation_types').delete().eq('id', oldCt.id)
  }
  await supa.from('audit_log').delete()
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('action', 'create_appointment_blocked_by_rule')
    .filter('details->>patient_phone', 'eq', TEST_PATIENT_PHONE)
  console.log('  Cleanup OK')

  // --- Step 2: crear consultation_type de prueba ---
  console.log('\n=== Step 2: Crear consultation_type de prueba ===')
  const { data: ct, error: ctErr } = await supa
    .from('consultation_types')
    .insert({
      clinic_id: ALGIA_CLINIC_ID,
      doctor_id: doctorId,
      name: TEST_CT_NAME,
      duration_minutes: 30,
      price: 100000,
      is_active: true,
      bookable_via_whatsapp: true,
      modality: 'presencial',
      eps_name: null,
    })
    .select('id')
    .single()
  if (ctErr || !ct) {
    console.error(`FATAL: error creando CT: ${ctErr?.message}`)
    process.exit(1)
  }
  console.log(`  CT creado: ${ct.id}`)

  // --- Step 3: insertar regla escalate_human activa ---
  console.log('\n=== Step 3: Insertar regla escalate_human activa ===')
  const { data: rule, error: ruleErr } = await supa
    .from('consultation_type_rules')
    .insert({
      consultation_type_id: ct.id,
      clinic_id: ALGIA_CLINIC_ID,
      rule_type: 'escalate_human',
      condition_config: {},
      action: 'derivar_humano',
      message: null,
      active: true,
    })
    .select('id')
    .single()
  if (ruleErr || !rule) {
    console.error(`FATAL: error creando regla: ${ruleErr?.message}`)
    process.exit(1)
  }
  console.log(`  Regla creada: ${rule.id}`)

  // --- Step 4: simular create_appointment ---
  // Importamos el executor DESPUÉS de tener todo el setup
  console.log('\n=== Step 4: Llamar createAppointment via executor ===')
  const { executeTool } = await import('../src/agents/tools/executor')
  const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
  if (!clinicRow) {
    console.error('FATAL: clinic no encontrada')
    process.exit(1)
  }

  // Fecha futura para evitar conflicto con citas reales (15 días adelante a las 23:30 — slot raro)
  const future = new Date()
  future.setDate(future.getDate() + 15)
  future.setHours(23, 30, 0, 0)
  const startsAt = future.toISOString()

  const { data: doctorRow } = await supa.from('doctors').select('*').eq('id', doctorId).single()
  if (!doctorRow) { console.error('FATAL: doctor desapareció'); process.exit(1) }

  const result = await executeTool(
    'create_appointment',
    {
      doctor_id: doctorId,
      patient_name: 'Paciente Test Bloque1',
      patient_phone: TEST_PATIENT_PHONE,
      starts_at: startsAt,
      consultation_type_id: ct.id,
      date_of_birth: '1990-01-01',
      document_type: 'CC',
      document_number: '99900001',
    },
    ALGIA_CLINIC_ID,
    clinicRow,
    doctorRow,
  )

  console.log('  Resultado del tool:')
  console.log(`    success: ${result.success}`)
  console.log(`    error: ${result.error}`)
  console.log(`    data: ${JSON.stringify(result.data)}`)

  // --- Step 5: assertions ---
  console.log('\n=== Step 5: Assertions ===')

  assert(
    'success === false (rechazó el agendamiento)',
    result.success === false,
  )

  assert(
    'error === "BLOCKED_BY_RULE_ESCALATE_HUMAN"',
    result.error === 'BLOCKED_BY_RULE_ESCALATE_HUMAN',
    `recibí: ${result.error}`,
  )

  const data = (result.data ?? {}) as Record<string, unknown>
  assert(
    'data.must_escalate === true',
    data.must_escalate === true,
    `recibí must_escalate=${data.must_escalate}`,
  )

  assert(
    'data.escalate_reason está presente',
    typeof data.escalate_reason === 'string' && (data.escalate_reason as string).length > 0,
  )

  assert(
    'data.message_for_patient está presente',
    typeof data.message_for_patient === 'string' && (data.message_for_patient as string).length > 0,
  )

  // Verificar que NO se creó la cita
  const { data: aptsCreated } = await supa
    .from('appointments')
    .select('id')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('consultation_type_id', ct.id)
  assert(
    'NO se creó fila en appointments',
    (aptsCreated ?? []).length === 0,
    `encontré ${aptsCreated?.length} citas para el CT de prueba`,
  )

  // Verificar que SÍ se creó audit_log
  const { data: auditLogs } = await supa
    .from('audit_log')
    .select('id, action, details')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('action', 'create_appointment_blocked_by_rule')
    .eq('target_id', ct.id)
  assert(
    'SÍ se creó audit_log con action=create_appointment_blocked_by_rule',
    (auditLogs ?? []).length === 1,
    `encontré ${auditLogs?.length} audit logs`,
  )

  if (auditLogs && auditLogs.length === 1) {
    const det = (auditLogs[0].details as Record<string, unknown>) ?? {}
    assert(
      'audit_log.details.llm_attempted_anyway === true',
      det.llm_attempted_anyway === true,
    )
    assert(
      'audit_log.details.rule_type === "escalate_human"',
      det.rule_type === 'escalate_human',
    )
  }

  // --- Cleanup final ---
  console.log('\n=== Cleanup final ===')
  await supa.from('audit_log').delete()
    .eq('target_id', ct.id)
    .eq('action', 'create_appointment_blocked_by_rule')
  await supa.from('consultation_type_rules').delete().eq('id', rule.id)
  await supa.from('consultation_types').delete().eq('id', ct.id)
  console.log('  Cleanup OK')

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
