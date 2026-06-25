/**
 * NIVEL C — Demo extensión bloque 3 (multi-choice) contra LLM en vivo.
 *
 * Activa regla multi-choice ("¿El mapeo es por cuál causa?" con 4 opciones)
 * en un CT temporal de prueba, corre los 4 casos principales + 1 edge
 * (respuesta que no encaja en ninguna opción), limpia.
 *
 * Al final corre 1 caso del DEMO ORIGINAL del bloque 3 (yes/no embarazo)
 * como REGRESIÓN — debe comportarse idéntico a antes.
 *
 * Casos multi-choice:
 *   1. Paciente responde "endometriosis" → continuar (agenda normal)
 *   2. Paciente responde "es por miomas" → continuar
 *   3. Paciente responde "es por otra causa" → deriva (Otras)
 *   4. Paciente responde "no sé" → deriva (ambiguous)
 *   5. EDGE: paciente responde "es por unos quistes" (no encaja) → deriva
 *
 * Regresión (al final):
 *   - Paciente embarazada (yes/no clásico) → deriva idéntico al bloque 3 v1
 *
 * Run: TZ=America/Bogota npx tsx scripts/demo-patient-condition-mc-conversations.ts
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
if (existsSync('.env.local')) {
  const c = readFileSync('.env.local', 'utf-8')
  const m = c.split('\n').find((l) => l.trim().startsWith('ANTHROPIC_API_KEY='))
  if (m) {
    let v = m.slice(m.indexOf('=') + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    ;(process.env as Record<string, string>).ANTHROPIC_API_KEY = v
  }
}

import { createClient } from '@supabase/supabase-js'
import type { Clinic, ConsultationType, Doctor, Message, WhatsAppConfig } from '../src/types/database'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const DOCTOR_JUAN_DIEGO_ID = '97a20f5e-4aac-48d0-bef9-4240e666dca5'
const DEMO_PHONE = '+573008989898'
const DEMO_NAME = 'Paciente Demo MC'
const TEST_CT_NAME = '__DEMO_MC_MAPEO__'

// CT con regla yes/no activa (regresión)
const PRIMERA_VEZ_CT_ID = 'df055e0b-cf1d-4a3b-a0e9-53aef6afece7'
const REGRESSION_PHONE = '+573008989899'
const REGRESSION_NAME = 'Paciente Demo Regresión'

async function main(): Promise<void> {
  const clientMod = await import('../src/lib/anthropic/client')
  ;(clientMod.CLAUDE_CONFIG as unknown as { model: string }).model = 'claude-sonnet-4-6'
  console.log(`  Modelo override (demo): claude-sonnet-4-6`)

  const { runAppointmentAgent } = await import('../src/agents/appointment-agent')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Demo extensión bloque 3 (multi-choice) — caso Algia mapeo')
  console.log('═══════════════════════════════════════════════════════════════')

  // Setup CT temporal + regla MC
  console.log('\nSetup: creando CT temporal + regla multi-choice...')
  // Cleanup previo
  const { data: oldCts } = await supa.from('consultation_types').select('id')
    .eq('clinic_id', ALGIA_CLINIC_ID).eq('name', TEST_CT_NAME)
  for (const oldCt of oldCts ?? []) {
    await supa.from('consultation_type_rules').delete().eq('consultation_type_id', oldCt.id)
    await supa.from('appointments').delete().eq('consultation_type_id', oldCt.id)
    await supa.from('consultation_types').delete().eq('id', oldCt.id)
  }
  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).in('phone', [DEMO_PHONE, REGRESSION_PHONE])

  const { data: testCt } = await supa.from('consultation_types').insert({
    clinic_id: ALGIA_CLINIC_ID,
    doctor_id: DOCTOR_JUAN_DIEGO_ID,
    name: TEST_CT_NAME,
    duration_minutes: 30,
    price: 250000,
    is_active: true,
    bookable_via_whatsapp: true,
    modality: 'presencial',
    eps_name: null,
  }).select('id').single()
  if (!testCt) { console.error('FATAL ct'); process.exit(1) }

  const { data: mcRule } = await supa.from('consultation_type_rules').insert({
    consultation_type_id: testCt.id,
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
  if (!mcRule) { console.error('FATAL rule'); process.exit(1) }
  console.log(`  CT temporal: ${testCt.id}`)
  console.log(`  Regla MC: ${mcRule.id}`)

  try {
    const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
    const { data: doctors } = await supa.from('doctors').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const { data: cts } = await supa.from('consultation_types').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const doctor = doctors!.find((d) => d.id === DOCTOR_JUAN_DIEGO_ID) ?? doctors![0]
    const waConfig = (clinicRow!.whatsapp_config as WhatsAppConfig) ?? null

    async function runCase(label: string, history: Message[], lastMsg: string, phone: string, name: string): Promise<{ text: string; tools: string[] }> {
      console.log('\n═══════════════════════════════════════════════════════════════')
      console.log(`  ${label}`)
      console.log('═══════════════════════════════════════════════════════════════')
      if (history.length > 0) {
        console.log('Historial previo:')
        for (const m of history) console.log(`  [${m.role}] ${m.content}`)
      }
      console.log(`\nPaciente: "${lastMsg}"`)
      const t0 = Date.now()
      const resp = await runAppointmentAgent({
        patientMessage: lastMsg,
        messageHistory: history,
        clinic: clinicRow as Clinic,
        doctor: doctor as Doctor,
        doctors: doctors as Doctor[],
        waConfig: waConfig ?? undefined,
        consultationTypes: cts as ConsultationType[],
        patientPhone: phone,
        patientName: name,
        existingPatient: null,
      })
      const el = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`\nAgente (${el}s, tokens in=${resp.tokenUsage.input}/out=${resp.tokenUsage.output}):`)
      console.log('───────────────────────────────────────────────────────────────')
      console.log(resp.text)
      console.log('───────────────────────────────────────────────────────────────')
      console.log(`Tools: ${resp.toolsUsed.length === 0 ? '(ninguna)' : resp.toolsUsed.join(', ')}`)
      return { text: resp.text, tools: resp.toolsUsed }
    }

    function buildMcHistory(pacienteNombre: string, doc: string): Message[] {
      return [
        {
          id: 'h1', conversation_id: 'demo', role: 'patient',
          content: `Hola, quiero agendar ${TEST_CT_NAME.toLowerCase()} con el Dr. Juan Diego`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 240000).toISOString(),
        } as unknown as Message,
        {
          id: 'h2', conversation_id: 'demo', role: 'agent',
          content: 'Claro, con gusto te ayudo. Para agendar necesito tus datos: nombre completo, cédula, fecha de nacimiento, correo, dirección y modalidad de pago.',
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 180000).toISOString(),
        } as unknown as Message,
        {
          id: 'h3', conversation_id: 'demo', role: 'patient',
          content: `Mi nombre es ${pacienteNombre}, CC ${doc}, fecha de nacimiento 15/03/1990, ${pacienteNombre.toLowerCase().replace(' ', '.')}@correo.com, vivo en Pereira, voy particular.`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 60000).toISOString(),
        } as unknown as Message,
      ]
    }

    // CASO 1 — endometriosis (continuar)
    const h1 = buildMcHistory('Laura Martínez', '1234567890')
    const r1 = await runCase(
      'CASO 1 — Paciente responde "endometriosis" (continuar)',
      h1, 'Mis datos están todos arriba.', DEMO_PHONE, DEMO_NAME,
    )
    const h1Turn2: Message[] = [
      ...h1,
      { id: 'h4', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h5', conversation_id: 'demo', role: 'agent', content: r1.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 1 — Turno 2: responde "endometriosis"',
      h1Turn2, 'Es por endometriosis.', DEMO_PHONE, DEMO_NAME)
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // CASO 2 — miomas (continuar)
    const h2 = buildMcHistory('Carmen Restrepo', '2345678901')
    const r2 = await runCase(
      'CASO 2 — Paciente responde "es por miomas" (continuar)',
      h2, 'Mis datos están todos arriba.', DEMO_PHONE, DEMO_NAME,
    )
    const h2Turn2: Message[] = [
      ...h2,
      { id: 'h4', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h5', conversation_id: 'demo', role: 'agent', content: r2.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 2 — Turno 2: responde "es por miomas"',
      h2Turn2, 'Es por miomas.', DEMO_PHONE, DEMO_NAME)
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // CASO 3 — Otras (deriva)
    const h3 = buildMcHistory('Sofía Ramírez', '3456789012')
    const r3 = await runCase(
      'CASO 3 — Paciente responde "es por otra causa" (Otras → deriva)',
      h3, 'Mis datos están todos arriba.', DEMO_PHONE, DEMO_NAME,
    )
    const h3Turn2: Message[] = [
      ...h3,
      { id: 'h4', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h5', conversation_id: 'demo', role: 'agent', content: r3.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 3 — Turno 2: responde "es por otra causa"',
      h3Turn2, 'Es por otra causa, no de esas.', DEMO_PHONE, DEMO_NAME)
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // CASO 4 — Ambiguous "no sé"
    const h4 = buildMcHistory('Andrea Castro', '4567890123')
    const r4 = await runCase(
      'CASO 4 — Paciente responde "no sé" (ambiguous → deriva)',
      h4, 'Mis datos están todos arriba.', DEMO_PHONE, DEMO_NAME,
    )
    const h4Turn2: Message[] = [
      ...h4,
      { id: 'h4a', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h4b', conversation_id: 'demo', role: 'agent', content: r4.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 4 — Turno 2: responde "no sé"',
      h4Turn2, 'La verdad no sé, mi doctor me lo pidió sin explicar.', DEMO_PHONE, DEMO_NAME)
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // CASO 5 — EDGE: respuesta no encaja en ninguna opción
    const h5 = buildMcHistory('Lucía Vargas', '5678901234')
    const r5 = await runCase(
      'CASO 5 (EDGE) — Paciente responde "es por unos quistes" (no encaja → debe derivar)',
      h5, 'Mis datos están todos arriba.', DEMO_PHONE, DEMO_NAME,
    )
    const h5Turn2: Message[] = [
      ...h5,
      { id: 'h5a', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h5b', conversation_id: 'demo', role: 'agent', content: r5.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 5 — Turno 2: responde "es por unos quistes"',
      h5Turn2, 'Es por unos quistes que me encontraron.', DEMO_PHONE, DEMO_NAME)
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

  } finally {
    console.log('\nCleanup MC...')
    await supa.from('audit_log').delete()
      .eq('clinic_id', ALGIA_CLINIC_ID)
      .eq('action', 'create_appointment_blocked_by_rule')
      .filter('details->>patient_phone', 'eq', DEMO_PHONE)
    await supa.from('consultation_type_rules').delete().eq('consultation_type_id', testCt.id)
    await supa.from('consultation_types').delete().eq('id', testCt.id)
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    console.log('  Cleanup MC OK.')
  }

  // ====================================================
  // REGRESIÓN — yes/no embarazo (caso 2 del bloque 3 v1)
  // ====================================================
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  CASO 6 (REGRESIÓN yes/no) — paciente embarazada, regla activa')
  console.log('═══════════════════════════════════════════════════════════════')

  // Activar la regla yes_no embarazo (igual que el demo v1)
  await supa.from('consultation_type_rules').delete()
    .eq('consultation_type_id', PRIMERA_VEZ_CT_ID)
    .eq('rule_type', 'patient_condition')
  const { data: yesNoRule } = await supa.from('consultation_type_rules').insert({
    consultation_type_id: PRIMERA_VEZ_CT_ID,
    clinic_id: ALGIA_CLINIC_ID,
    rule_type: 'patient_condition',
    condition_config: {
      question_type: 'yes_no',
      question: '¿Estás embarazada actualmente?',
      trigger_answer: 'yes',
      action_on_trigger: 'derivar_humano',
      verification_mode: 'trust',
    },
    action: 'derivar_humano',
    message: null,
    active: true,
  }).select('id').single()
  if (!yesNoRule) { console.error('FATAL regression rule'); process.exit(1) }

  try {
    const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
    const { data: doctors } = await supa.from('doctors').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const { data: cts } = await supa.from('consultation_types').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const doctor = doctors!.find((d) => d.id === DOCTOR_JUAN_DIEGO_ID) ?? doctors![0]
    const waConfig = (clinicRow!.whatsapp_config as WhatsAppConfig) ?? null

    const regHistory: Message[] = [
      {
        id: 'r1', conversation_id: 'reg', role: 'patient',
        content: 'Buenas tardes, quiero agendar consulta de primera vez por ginecología con el Dr. Juan Diego',
        whatsapp_message_id: null, message_type: 'text', metadata: {},
        created_at: new Date(Date.now() - 240000).toISOString(),
      } as unknown as Message,
      {
        id: 'r2', conversation_id: 'reg', role: 'agent',
        content: 'Claro, con gusto te ayudo. Para agendar necesito tus datos: nombre completo, cédula, fecha de nacimiento, correo, dirección y modalidad de pago.',
        whatsapp_message_id: null, message_type: 'text', metadata: {},
        created_at: new Date(Date.now() - 180000).toISOString(),
      } as unknown as Message,
      {
        id: 'r3', conversation_id: 'reg', role: 'patient',
        content: 'Mi nombre es Andrea Vélez, CC 1234567890, fecha de nacimiento 15/03/1990, andrea.velez@correo.com, vivo en Pereira, voy particular.',
        whatsapp_message_id: null, message_type: 'text', metadata: {},
        created_at: new Date(Date.now() - 60000).toISOString(),
      } as unknown as Message,
    ]

    console.log('\nPaciente: "Mis datos están todos arriba."')
    const t0 = Date.now()
    const regResp = await runAppointmentAgent({
      patientMessage: 'Mis datos están todos arriba.',
      messageHistory: regHistory,
      clinic: clinicRow as Clinic,
      doctor: doctor as Doctor,
      doctors: doctors as Doctor[],
      waConfig: waConfig ?? undefined,
      consultationTypes: cts as ConsultationType[],
      patientPhone: REGRESSION_PHONE,
      patientName: REGRESSION_NAME,
      existingPatient: null,
    })
    console.log(`\nAgente turno 1 (${((Date.now() - t0) / 1000).toFixed(1)}s):`)
    console.log('───────────────────────────────────────────────────────────────')
    console.log(regResp.text)
    console.log('───────────────────────────────────────────────────────────────')

    const regTurn2History: Message[] = [
      ...regHistory,
      { id: 'r4', conversation_id: 'reg', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'r5', conversation_id: 'reg', role: 'agent', content: regResp.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    console.log('\nPaciente: "Sí, tengo 12 semanas."')
    const t1 = Date.now()
    const reg2 = await runAppointmentAgent({
      patientMessage: 'Sí, tengo 12 semanas.',
      messageHistory: regTurn2History,
      clinic: clinicRow as Clinic,
      doctor: doctor as Doctor,
      doctors: doctors as Doctor[],
      waConfig: waConfig ?? undefined,
      consultationTypes: cts as ConsultationType[],
      patientPhone: REGRESSION_PHONE,
      patientName: REGRESSION_NAME,
      existingPatient: null,
    })
    console.log(`\nAgente turno 2 (${((Date.now() - t1) / 1000).toFixed(1)}s):`)
    console.log('───────────────────────────────────────────────────────────────')
    console.log(reg2.text)
    console.log('───────────────────────────────────────────────────────────────')
    console.log(`Tools: ${reg2.toolsUsed.join(', ')}`)
    console.log(`Cita creada: ${reg2.appointmentData ? '🔴 SÍ' : 'NO'}`)
  } finally {
    console.log('\nCleanup regresión...')
    await supa.from('consultation_type_rules').delete()
      .eq('consultation_type_id', PRIMERA_VEZ_CT_ID)
      .eq('rule_type', 'patient_condition')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', REGRESSION_PHONE)
    await supa.from('audit_log').delete()
      .eq('clinic_id', ALGIA_CLINIC_ID)
      .eq('action', 'create_appointment_blocked_by_rule')
      .filter('details->>patient_phone', 'eq', REGRESSION_PHONE)
    console.log('Cleanup regresión OK.')
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
