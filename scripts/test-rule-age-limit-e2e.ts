/**
 * NIVEL A — Test E2E del check duro del bloque 2 (age_limit).
 *
 * Cubre los 4 escenarios que pasan por executor.create_appointment:
 *   1. Edad dentro de rango → success (creó la cita)
 *   2. Edad bajo el mínimo + action=rechazar → BLOCKED_BY_AGE_RECHAZAR
 *   3. Edad sobre el máximo + action=derivar_humano → BLOCKED_BY_AGE_DERIVAR
 *   4. Sin fecha de nacimiento → BLOCKED_BY_AGE_UNKNOWN (force escalate)
 *
 * Audit log verificado en cada caso fuera del happy path.
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-rule-age-limit-e2e.ts
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
const TEST_CT_NAME = '__TEST_AGE_LIMIT_RULE__'
const TEST_PATIENT_PHONE = '+573999000002'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

function isoDateForAge(age: number, today: Date = new Date()): string {
  // Fecha que produce exactamente `age` años hoy: cumpleaños = hace age años hoy
  const d = new Date(today)
  d.setFullYear(d.getFullYear() - age)
  // Hace 1 día por seguridad para evitar el caso borde de cumpleaños mañana
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  NIVEL A — Test E2E check duro age_limit')
  console.log('═══════════════════════════════════════════════════════════════')

  // --- Step 0: pick a real doctor from Algia ---
  const { data: docRow } = await supa
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (!docRow) { console.error('FATAL: no hay doctores activos en Algia'); process.exit(1) }
  const doctorId = docRow.id
  console.log(`\nDoctor de prueba: ${docRow.name}`)

  // --- Step 1: cleanup previo ---
  console.log('\n=== Step 1: Cleanup previo ===')
  const { data: oldCts } = await supa.from('consultation_types').select('id').eq('clinic_id', ALGIA_CLINIC_ID).eq('name', TEST_CT_NAME)
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

  // --- Step 2: crear CT de prueba ---
  console.log('\n=== Step 2: Crear consultation_type de prueba ===')
  const { data: ct } = await supa
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
  if (!ct) { console.error('FATAL: error creando CT'); process.exit(1) }
  console.log(`  CT creado: ${ct.id}`)

  // --- Step 3: insertar regla age_limit (Mapeo case: 18-50) ---
  console.log('\n=== Step 3: Insertar regla age_limit (18-50, below=rechazar, above=derivar) ===')
  const { data: rule } = await supa
    .from('consultation_type_rules')
    .insert({
      consultation_type_id: ct.id,
      clinic_id: ALGIA_CLINIC_ID,
      rule_type: 'age_limit',
      condition_config: {
        min: 18, max: 50,
        action_below_min: 'rechazar',
        action_above_max: 'derivar_humano',
      },
      action: 'rechazar', // más restrictivo de los 2
      message: null,
      active: true,
    })
    .select('id')
    .single()
  if (!rule) { console.error('FATAL: error creando regla'); process.exit(1) }
  console.log(`  Regla creada: ${rule.id}`)

  // --- Step 4: cargar clinic+doctor para executeTool ---
  const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
  const { data: doctorRow } = await supa.from('doctors').select('*').eq('id', doctorId).single()
  if (!clinicRow || !doctorRow) { console.error('FATAL'); process.exit(1) }

  const { executeTool } = await import('../src/agents/tools/executor')

  // Fecha futura con slot raro
  const future = new Date()
  future.setDate(future.getDate() + 15)
  future.setHours(23, 30, 0, 0)
  const startsAt = future.toISOString()

  function baseInput(dob: string | null): Record<string, unknown> {
    return {
      doctor_id: doctorId,
      patient_name: 'Paciente Test Edad',
      patient_phone: TEST_PATIENT_PHONE,
      starts_at: startsAt,
      consultation_type_id: ct!.id,
      date_of_birth: dob,
      document_type: 'CC',
      document_number: '99900002',
    }
  }

  // ---- Caso 1: edad dentro de rango (30 años) ----
  console.log('\n=== Caso 1: edad 30 (dentro de rango 18-50) ===')
  const dob30 = isoDateForAge(30)
  const r1 = await executeTool('create_appointment', baseInput(dob30), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=true (cita creada)', r1.success === true, `error=${r1.error}`)

  // Cleanup de la cita creada para no contaminar
  await supa.from('appointments').delete()
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('consultation_type_id', ct.id)

  // ---- Caso 2: edad bajo mínimo (16 años) → rechazar ----
  console.log('\n=== Caso 2: edad 16 (bajo min=18, action=rechazar) ===')
  const dob16 = isoDateForAge(16)
  const r2 = await executeTool('create_appointment', baseInput(dob16), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false', r2.success === false)
  assert('error=BLOCKED_BY_AGE_RECHAZAR', r2.error === 'BLOCKED_BY_AGE_RECHAZAR', `recibí ${r2.error}`)
  assert('outcome=below_min', (r2.data as Record<string, unknown>)?.outcome === 'below_min')
  assert('must_escalate=false (rechazar no escala)',
    (r2.data as Record<string, unknown>)?.must_escalate === false)
  assert('message_for_patient menciona 18 años',
    typeof (r2.data as Record<string, unknown>)?.message_for_patient === 'string' &&
    ((r2.data as Record<string, unknown>).message_for_patient as string).includes('18'))

  // ---- Caso 3: edad sobre máximo (62 años) → derivar ----
  console.log('\n=== Caso 3: edad 62 (sobre max=50, action=derivar_humano) ===')
  const dob62 = isoDateForAge(62)
  const r3 = await executeTool('create_appointment', baseInput(dob62), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false', r3.success === false)
  assert('error=BLOCKED_BY_AGE_DERIVAR', r3.error === 'BLOCKED_BY_AGE_DERIVAR', `recibí ${r3.error}`)
  assert('outcome=above_max', (r3.data as Record<string, unknown>)?.outcome === 'above_max')
  assert('must_escalate=true (derivar escala)',
    (r3.data as Record<string, unknown>)?.must_escalate === true)
  assert('escalate_reason presente',
    typeof (r3.data as Record<string, unknown>)?.escalate_reason === 'string')

  // ---- Caso 4: sin fecha de nacimiento → BLOCKED_BY_AGE_UNKNOWN ----
  // Eliminar al paciente antes para simular paciente nuevo sin DOB en DB
  console.log('\n=== Caso 4: sin date_of_birth (DOB null + paciente nuevo) ===')
  await supa.from('patients').delete()
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('phone', TEST_PATIENT_PHONE)
  const r4 = await executeTool('create_appointment', baseInput(null), ALGIA_CLINIC_ID, clinicRow, doctorRow)
  assert('success=false', r4.success === false)
  assert('error=BLOCKED_BY_AGE_UNKNOWN', r4.error === 'BLOCKED_BY_AGE_UNKNOWN', `recibí ${r4.error}`)
  assert('outcome=age_unknown',
    (r4.data as Record<string, unknown>)?.outcome === 'age_unknown')
  assert('must_escalate=true (safe default)',
    (r4.data as Record<string, unknown>)?.must_escalate === true)

  // Verificar audit_log
  console.log('\n=== Audit log: 3 entries esperadas (caso 2, 3, 4) ===')
  const { data: auditLogs } = await supa
    .from('audit_log')
    .select('details')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('action', 'create_appointment_blocked_by_rule')
    .eq('target_id', ct.id)
  assert('3 audit logs (uno por caso bloqueado)', (auditLogs ?? []).length === 3,
    `recibí ${auditLogs?.length}`)
  const outcomes = (auditLogs ?? []).map((l) => (l.details as Record<string, unknown>)?.outcome)
  assert('audit incluye below_min', outcomes.includes('below_min'))
  assert('audit incluye above_max', outcomes.includes('above_max'))
  assert('audit incluye age_unknown', outcomes.includes('age_unknown'))

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
