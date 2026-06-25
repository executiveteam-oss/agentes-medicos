/**
 * NIVEL A — Test E2E del check duro del bloque 3 (patient_condition).
 *
 * Cubre los 5 escenarios que pasan por executor.create_appointment:
 *   1. Sin respuestas → BLOCKED_CONDITION_NOT_ASKED
 *   2. Respuesta apta (no dispara) → success
 *   3. Respuesta dispara (trigger match) con action=derivar → BLOCKED_BY_CONDITION_DERIVAR
 *   4. Respuesta dispara con action=rechazar → BLOCKED_BY_CONDITION_RECHAZAR
 *   5. Respuesta ambigua → BLOCKED_BY_CONDITION_AMBIGUOUS (force escalate)
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-rule-patient-condition-e2e.ts
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
const TEST_CT_NAME = '__TEST_PATIENT_CONDITION_RULE__'
const TEST_PATIENT_PHONE = '+573999000003'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  NIVEL A — Test E2E check duro patient_condition')
  console.log('═══════════════════════════════════════════════════════════════')

  // --- Step 0: pick a real doctor ---
  const { data: docRow } = await supa.from('doctors').select('id, name')
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true).limit(1).single()
  if (!docRow) { console.error('FATAL: no doctores'); process.exit(1) }
  console.log(`\nDoctor de prueba: ${docRow.name}`)

  // --- Step 1: cleanup ---
  console.log('\n=== Step 1: Cleanup previo ===')
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
  console.log('  Cleanup OK')

  // --- Step 2: CT de prueba ---
  console.log('\n=== Step 2: Crear consultation_type de prueba ===')
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
  if (!ct) { console.error('FATAL CT'); process.exit(1) }

  // --- Step 3: 2 reglas activas: 1 gestantes (derivar), 1 ayuno (rechazar) ---
  console.log('\n=== Step 3: 2 reglas activas ===')
  const { data: ruleGestantes } = await supa.from('consultation_type_rules').insert({
    consultation_type_id: ct.id,
    clinic_id: ALGIA_CLINIC_ID,
    rule_type: 'patient_condition',
    condition_config: {
      question: '¿Estás embarazada actualmente?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
      verification_mode: 'trust',
    },
    action: 'derivar_humano',
    message: null,
    active: true,
  }).select('id').single()
  const { data: ruleAyuno } = await supa.from('consultation_type_rules').insert({
    consultation_type_id: ct.id,
    clinic_id: ALGIA_CLINIC_ID,
    rule_type: 'patient_condition',
    condition_config: {
      question: '¿Has cumplido 8 horas de ayuno?',
      trigger_answer: 'no',
      action_on_trigger: 'rechazar',
      verification_mode: 'trust',
    },
    action: 'rechazar',
    message: null,
    active: true,
  }).select('id').single()
  if (!ruleGestantes || !ruleAyuno) { console.error('FATAL rule'); process.exit(1) }
  console.log(`  Regla gestantes: ${ruleGestantes.id}`)
  console.log(`  Regla ayuno: ${ruleAyuno.id}`)

  // --- Setup ejecución ---
  const { executeTool } = await import('../src/agents/tools/executor')
  const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
  const { data: doctorRow } = await supa.from('doctors').select('*').eq('id', docRow.id).single()
  if (!clinicRow || !doctorRow) { console.error('FATAL'); process.exit(1) }

  const future = new Date()
  future.setDate(future.getDate() + 14)
  future.setHours(23, 30, 0, 0)
  const startsAt = future.toISOString()

  function baseInput(answers: Record<string, 'yes' | 'no' | 'ambiguous'> | undefined): Record<string, unknown> {
    return {
      doctor_id: docRow!.id,
      patient_name: 'Paciente Test Condition',
      patient_phone: TEST_PATIENT_PHONE,
      starts_at: startsAt,
      consultation_type_id: ct!.id,
      date_of_birth: '1990-01-01',
      document_type: 'CC',
      document_number: '99900003',
      ...(answers !== undefined ? { patient_condition_answers: answers } : {}),
    }
  }

  // ---- Caso 1: SIN respuestas → NOT_ASKED ----
  console.log('\n=== Caso 1: SIN patient_condition_answers ===')
  const r1 = await executeTool('create_appointment', baseInput(undefined), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false', r1.success === false)
  assert('error=BLOCKED_CONDITION_NOT_ASKED', r1.error === 'BLOCKED_CONDITION_NOT_ASKED', `recibí ${r1.error}`)
  const d1 = (r1.data ?? {}) as Record<string, unknown>
  assert('missing_questions tiene 2 items',
    Array.isArray(d1.missing_questions) && (d1.missing_questions as unknown[]).length === 2)

  // ---- Caso 2: respuestas aptas (no dispara) ----
  console.log('\n=== Caso 2: Respuestas APTAS (no embarazada + sí ayunó) ===')
  const r2 = await executeTool('create_appointment', baseInput({
    [ruleGestantes.id]: 'no',  // trigger=yes, respondió no → apto
    [ruleAyuno.id]: 'yes',      // trigger=no, respondió yes → apto
  }), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=true (cita creada)', r2.success === true, `error=${r2.error}`)

  // Cleanup de la cita creada
  await supa.from('appointments').delete()
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('consultation_type_id', ct.id)
  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', TEST_PATIENT_PHONE)

  // ---- Caso 3: gestante → trigger derivar ----
  console.log('\n=== Caso 3: SÍ embarazada (trigger=yes → derivar) ===')
  const r3 = await executeTool('create_appointment', baseInput({
    [ruleGestantes.id]: 'yes',
    [ruleAyuno.id]: 'yes',
  }), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false', r3.success === false)
  assert('error=BLOCKED_BY_CONDITION_DERIVAR', r3.error === 'BLOCKED_BY_CONDITION_DERIVAR', `recibí ${r3.error}`)
  const d3 = (r3.data ?? {}) as Record<string, unknown>
  assert('must_escalate=true', d3.must_escalate === true)
  assert('outcome=triggered', d3.outcome === 'triggered')

  // ---- Caso 4: no ayunó → trigger rechazar ----
  console.log('\n=== Caso 4: NO ayunó (trigger=no → rechazar) ===')
  const r4 = await executeTool('create_appointment', baseInput({
    [ruleGestantes.id]: 'no',
    [ruleAyuno.id]: 'no', // dispara
  }), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false', r4.success === false)
  assert('error=BLOCKED_BY_CONDITION_RECHAZAR', r4.error === 'BLOCKED_BY_CONDITION_RECHAZAR', `recibí ${r4.error}`)
  const d4 = (r4.data ?? {}) as Record<string, unknown>
  assert('must_escalate=false (rechazar)', d4.must_escalate === false)

  // ---- Caso 5: respuesta ambigua → siempre derivar ----
  console.log('\n=== Caso 5: Respuesta AMBIGUA al ayuno (debería derivar incluso si trigger=no/rechazar) ===')
  const r5 = await executeTool('create_appointment', baseInput({
    [ruleGestantes.id]: 'no',
    [ruleAyuno.id]: 'ambiguous',
  }), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false', r5.success === false)
  assert('error=BLOCKED_BY_CONDITION_AMBIGUOUS', r5.error === 'BLOCKED_BY_CONDITION_AMBIGUOUS', `recibí ${r5.error}`)
  const d5 = (r5.data ?? {}) as Record<string, unknown>
  assert('must_escalate=true (safe default)', d5.must_escalate === true)
  assert('outcome=ambiguous', d5.outcome === 'ambiguous')

  // ---- Verificar audit log ----
  console.log('\n=== Audit log: 4 entries bloqueadas esperadas (casos 1,3,4,5) ===')
  const { data: audits } = await supa.from('audit_log')
    .select('details')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('action', 'create_appointment_blocked_by_rule')
    .eq('target_id', ct.id)
  assert('4 audit logs', (audits ?? []).length === 4, `recibí ${audits?.length}`)
  const outcomes = (audits ?? []).map((a) => (a.details as Record<string, unknown>)?.outcome)
  assert('audit incluye not_asked', outcomes.includes('not_asked'))
  assert('audit incluye triggered (caso 3 y 4)',
    outcomes.filter((o) => o === 'triggered').length === 2)
  assert('audit incluye ambiguous', outcomes.includes('ambiguous'))

  // ---- Cleanup final ----
  console.log('\n=== Cleanup final ===')
  await supa.from('audit_log').delete().eq('target_id', ct.id).eq('action', 'create_appointment_blocked_by_rule')
  await supa.from('consultation_type_rules').delete().eq('consultation_type_id', ct.id)
  await supa.from('consultation_types').delete().eq('id', ct.id)
  console.log('  Cleanup OK')

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  // ========================================================
  // EXTENSIÓN multi-choice (2026-06-25)
  // Creamos otro CT con regla multi-choice y verificamos los 4
  // outcomes: continuar, derivar, ambiguous, id inválido.
  // ========================================================

  console.log('\n=== EXTENSIÓN multi-choice: setup CT separado ===')
  if (!docRow) { console.error('FATAL: docRow null'); process.exit(1) }
  const MC_TEST_CT_NAME = '__TEST_PATIENT_CONDITION_MC__'
  const MC_TEST_PATIENT_PHONE = '+573999000007'

  // Cleanup MC
  const { data: oldMcCts } = await supa.from('consultation_types').select('id')
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('name', MC_TEST_CT_NAME)
  for (const oldCt of oldMcCts ?? []) {
    await supa.from('consultation_type_rules').delete().eq('consultation_type_id', oldCt.id)
    await supa.from('appointments').delete().eq('consultation_type_id', oldCt.id)
    await supa.from('consultation_types').delete().eq('id', oldCt.id)
  }
  await supa.from('audit_log').delete()
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('action', 'create_appointment_blocked_by_rule')
    .filter('details->>patient_phone', 'eq', MC_TEST_PATIENT_PHONE)
  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', MC_TEST_PATIENT_PHONE)

  const { data: mcCt } = await supa.from('consultation_types').insert({
    clinic_id: ALGIA_CLINIC_ID,
    doctor_id: docRow.id,
    name: MC_TEST_CT_NAME,
    duration_minutes: 30,
    price: 100000,
    is_active: true,
    bookable_via_whatsapp: true,
    modality: 'presencial',
    eps_name: null,
  }).select('id').single()

  const { data: mcRule } = await supa.from('consultation_type_rules').insert({
    consultation_type_id: mcCt!.id,
    clinic_id: ALGIA_CLINIC_ID,
    rule_type: 'patient_condition',
    condition_config: {
      question_type: 'multiple_choice',
      question: '¿El mapeo es por cuál de estas causas?',
      options: [
        { id: 'opt_1', label: 'Endometriosis', action_if_chosen: 'continuar' },
        { id: 'opt_2', label: 'Miomas',        action_if_chosen: 'continuar' },
        { id: 'opt_3', label: 'Adenomiosis',   action_if_chosen: 'continuar' },
        { id: 'opt_4', label: 'Otras',         action_if_chosen: 'derivar_humano' },
      ],
      verification_mode: 'trust',
    },
    action: 'derivar_humano',
    message: null,
    active: true,
  }).select('id').single()

  const docId = docRow.id  // captured non-null
  function mcBaseInput(answer: string | undefined): Record<string, unknown> {
    return {
      doctor_id: docId,
      patient_name: 'Paciente MC Test',
      patient_phone: MC_TEST_PATIENT_PHONE,
      starts_at: startsAt,
      consultation_type_id: mcCt!.id,
      date_of_birth: '1990-01-01',
      document_type: 'CC',
      document_number: '99900007',
      ...(answer !== undefined ? { patient_condition_answers: { [mcRule!.id]: answer } } : {}),
    }
  }

  // Caso MC-1: respuesta opt_1 (Endometriosis, continuar) → success
  console.log('\n=== Caso MC-1: respuesta opt_1 (Endometriosis, continuar) ===')
  const mc1 = await executeTool('create_appointment', mcBaseInput('opt_1'), ALGIA_CLINIC_ID, clinicRow!, doctorRow!)
  assert('opt_1 → success=true', mc1.success === true, `error=${mc1.error}`)
  await supa.from('appointments').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('consultation_type_id', mcCt!.id)
  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', MC_TEST_PATIENT_PHONE)

  // Caso MC-2: opt_4 (Otras, derivar) → BLOCKED_BY_CONDITION_DERIVAR
  console.log('\n=== Caso MC-2: opt_4 (Otras, derivar_humano) ===')
  const mc2 = await executeTool('create_appointment', mcBaseInput('opt_4'), ALGIA_CLINIC_ID, clinicRow!, doctorRow!)
  assert('opt_4 → BLOCKED_BY_CONDITION_DERIVAR',
    mc2.success === false && mc2.error === 'BLOCKED_BY_CONDITION_DERIVAR',
    `error=${mc2.error}`)
  const mc2d = (mc2.data ?? {}) as Record<string, unknown>
  assert('mc2 must_escalate=true', mc2d.must_escalate === true)

  // Caso MC-3: ambiguous → BLOCKED_BY_CONDITION_AMBIGUOUS
  console.log('\n=== Caso MC-3: ambiguous ===')
  const mc3 = await executeTool('create_appointment', mcBaseInput('ambiguous'), ALGIA_CLINIC_ID, clinicRow!, doctorRow!)
  assert('ambiguous → BLOCKED_BY_CONDITION_AMBIGUOUS',
    mc3.success === false && mc3.error === 'BLOCKED_BY_CONDITION_AMBIGUOUS',
    `error=${mc3.error}`)

  // Caso MC-4: id inválido (LLM se inventó) → safe default = derivar
  console.log('\n=== Caso MC-4: id inexistente "opt_99" → safe default derivar ===')
  const mc4 = await executeTool('create_appointment', mcBaseInput('opt_99'), ALGIA_CLINIC_ID, clinicRow!, doctorRow!)
  assert('opt_99 → BLOCKED_BY_CONDITION_AMBIGUOUS (safe default)',
    mc4.success === false && mc4.error === 'BLOCKED_BY_CONDITION_AMBIGUOUS',
    `error=${mc4.error}`)

  // Verificar audit log multi-choice
  console.log('\n=== Audit multi-choice: outcomes esperados ===')
  const { data: mcAudits } = await supa.from('audit_log')
    .select('details')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('action', 'create_appointment_blocked_by_rule')
    .eq('target_id', mcCt!.id)
  const mcOutcomes = (mcAudits ?? []).map((a) => (a.details as Record<string, unknown>)?.outcome)
  assert('audit MC tiene triggered', mcOutcomes.includes('triggered'))
  assert('audit MC tiene ambiguous', mcOutcomes.includes('ambiguous'))
  assert('audit MC tiene invalid_option', mcOutcomes.includes('invalid_option'))
  // Verificar que el caso triggered registró option_label_chosen
  const triggeredAudit = (mcAudits ?? []).find((a) => (a.details as Record<string, unknown>)?.outcome === 'triggered')
  if (triggeredAudit) {
    const det = triggeredAudit.details as Record<string, unknown>
    assert('audit triggered tiene option_label_chosen="Otras"',
      det.option_label_chosen === 'Otras')
  }

  // Cleanup MC
  console.log('\n=== Cleanup MC ===')
  await supa.from('audit_log').delete().eq('target_id', mcCt!.id).eq('action', 'create_appointment_blocked_by_rule')
  await supa.from('consultation_type_rules').delete().eq('consultation_type_id', mcCt!.id)
  await supa.from('consultation_types').delete().eq('id', mcCt!.id)
  console.log('  Cleanup OK')

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
