/**
 * NIVEL C — Demo bloque 3 (patient_condition) contra LLM en vivo.
 *
 * Activa regla "¿Estás embarazada actualmente?" (trigger=yes, action=derivar)
 * para CONSULTA DE PRIMERA VEZ POR GINECOLOGÍA en Algia. Corre 4 casos + edge.
 *
 * Casos:
 *   1. Paciente responde NO embarazada → agenda normal
 *   2. Paciente responde SÍ embarazada → deriva (tono no alarmante)
 *   3. Respuesta ambigua "no estoy segura" → deriva con gracia
 *   4. CT sin regla → flujo normal sin pregunta extra
 *   5. EDGE — paciente no quiere contestar la pregunta → escala
 *
 * Run: TZ=America/Bogota npx tsx scripts/demo-patient-condition-conversations.ts
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
const PRIMERA_VEZ_CT_ID = 'df055e0b-cf1d-4a3b-a0e9-53aef6afece7'
const CONTROL_CT_ID = 'cdb57967-5fc3-433e-b909-8dc6d20d382b'
const DOCTOR_JUAN_DIEGO_ID = '97a20f5e-4aac-48d0-bef9-4240e666dca5'
const DEMO_PHONE = '+573007777777'
const DEMO_NAME = 'Paciente Demo Condition'

async function main(): Promise<void> {
  const clientMod = await import('../src/lib/anthropic/client')
  ;(clientMod.CLAUDE_CONFIG as unknown as { model: string }).model = 'claude-sonnet-4-6'
  console.log(`  Modelo override (solo demo): claude-sonnet-4-6`)

  const { runAppointmentAgent } = await import('../src/agents/appointment-agent')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Demo BLOQUE 3 (patient_condition): "¿Estás embarazada?"')
  console.log('  Trigger=yes, Action=derivar_humano')
  console.log('═══════════════════════════════════════════════════════════════')

  console.log('\nSetup: activando regla en "CONSULTA DE PRIMERA VEZ POR GINECOLOGÍA"...')
  // Cleanup previo
  await supa.from('consultation_type_rules').delete()
    .eq('consultation_type_id', PRIMERA_VEZ_CT_ID)
    .eq('rule_type', 'patient_condition')

  const { data: rule, error: ruleErr } = await supa.from('consultation_type_rules').insert({
    consultation_type_id: PRIMERA_VEZ_CT_ID,
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
  if (ruleErr || !rule) { console.error('FATAL:', ruleErr); process.exit(1) }
  console.log(`  Regla activa: ${rule.id}`)

  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

  try {
    const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
    const { data: doctors } = await supa.from('doctors').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const { data: cts } = await supa.from('consultation_types').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const doctor = doctors!.find((d) => d.id === DOCTOR_JUAN_DIEGO_ID) ?? doctors![0]
    const waConfig = (clinicRow!.whatsapp_config as WhatsAppConfig) ?? null

    async function runCase(label: string, history: Message[], lastMsg: string): Promise<{ text: string; tools: string[]; created: unknown }> {
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
        patientPhone: DEMO_PHONE,
        patientName: DEMO_NAME,
        existingPatient: null,
      })
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

      console.log(`\nAgente respondió (${elapsed}s, tokens in=${resp.tokenUsage.input}/out=${resp.tokenUsage.output}):`)
      console.log('───────────────────────────────────────────────────────────────')
      console.log(resp.text)
      console.log('───────────────────────────────────────────────────────────────')
      console.log(`Tools: ${resp.toolsUsed.length === 0 ? '(ninguna)' : resp.toolsUsed.join(', ')}`)
      console.log(`Cita creada: ${resp.appointmentData ? '🔴 SÍ' : 'NO'}`)
      return { text: resp.text, tools: resp.toolsUsed, created: resp.appointmentData }
    }

    // Build base history: agente ya tiene los datos y está por preguntar la condición.
    // El paciente pidió la consulta de primera vez (CT con regla) o de control (sin regla).
    function buildHistory(pacienteNombre: string, doc: string, docType: 'CC' | 'TI', tipoNombre: string): Message[] {
      return [
        {
          id: 'h1', conversation_id: 'demo', role: 'patient',
          content: `Buenas tardes, quiero agendar ${tipoNombre.toLowerCase()} con el Dr. Juan Diego`,
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
          content: `Mi nombre es ${pacienteNombre}, ${docType} ${doc}, fecha de nacimiento 15/03/1990, ${pacienteNombre.toLowerCase().replace(' ', '.')}@correo.com, vivo en Pereira, voy particular.`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 60000).toISOString(),
        } as unknown as Message,
      ]
    }

    // ============================================================
    // Caso 1 — Paciente NO embarazada → agenda normal
    // ============================================================
    console.log('\n--- Caso 1: paciente responde NO embarazada ---')
    const h1 = buildHistory('Laura Martínez', '1234567890', 'CC', 'consulta de primera vez por ginecología')
    const r1a = await runCase(
      'CASO 1 — Responde NO embarazada (regla activa) — Turno 1',
      h1,
      'Mis datos están todos arriba.',
    )
    // Turno 2: el agente debería haber preguntado, paciente responde no
    const h1Turn2: Message[] = [
      ...h1,
      { id: 'h4', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h5', conversation_id: 'demo', role: 'agent', content: r1a.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 1 — Responde NO embarazada — Turno 2 (responde la pregunta)', h1Turn2, 'No, no estoy embarazada.')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    await supa.from('appointments').delete().eq('clinic_id', ALGIA_CLINIC_ID).filter('reason', 'ilike', '%Laura%')

    // ============================================================
    // Caso 2 — Paciente SÍ embarazada → deriva (tono cuidadoso)
    // ============================================================
    console.log('\n--- Caso 2: paciente responde SÍ embarazada ---')
    const h2 = buildHistory('Andrea Vélez', '2345678901', 'CC', 'consulta de primera vez por ginecología')
    const r2a = await runCase(
      'CASO 2 — Responde SÍ embarazada — Turno 1',
      h2,
      'Mis datos están todos arriba.',
    )
    const h2Turn2: Message[] = [
      ...h2,
      { id: 'h4', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h5', conversation_id: 'demo', role: 'agent', content: r2a.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 2 — Responde SÍ embarazada — Turno 2', h2Turn2, 'Sí, tengo 12 semanas.')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // ============================================================
    // Caso 3 — Respuesta ambigua → deriva con gracia
    // ============================================================
    console.log('\n--- Caso 3: respuesta AMBIGUA ---')
    const h3 = buildHistory('Sofía Ramírez', '3456789012', 'CC', 'consulta de primera vez por ginecología')
    const r3a = await runCase(
      'CASO 3 — Respuesta ambigua — Turno 1',
      h3,
      'Mis datos están todos arriba.',
    )
    const h3Turn2: Message[] = [
      ...h3,
      { id: 'h4', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h5', conversation_id: 'demo', role: 'agent', content: r3a.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 3 — Respuesta ambigua — Turno 2', h3Turn2, 'No estoy segura, llevo unos días con un atraso.')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // ============================================================
    // Caso 4 — CT SIN regla → flujo normal (no pregunta condición)
    // ============================================================
    console.log('\n--- Caso 4: CT SIN regla (control) ---')
    const h4 = buildHistory('Marcela Torres', '4567890123', 'CC', 'consulta de control de seguimiento por ginecología')
    await runCase('CASO 4 — Control de seguimiento (CT sin regla)', h4, 'Mis datos están todos arriba.')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // ============================================================
    // Caso 5 (EDGE) — Paciente no quiere contestar
    // ============================================================
    console.log('\n--- Caso 5 (EDGE): paciente no quiere contestar ---')
    const h5 = buildHistory('Diana Castro', '5678901234', 'CC', 'consulta de primera vez por ginecología')
    const r5a = await runCase(
      'CASO 5 (EDGE) — No quiere contestar — Turno 1',
      h5,
      'Mis datos están todos arriba.',
    )
    const h5Turn2: Message[] = [
      ...h5,
      { id: 'h4', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 90000).toISOString() } as unknown as Message,
      { id: 'h5', conversation_id: 'demo', role: 'agent', content: r5a.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 60000).toISOString() } as unknown as Message,
    ]
    const r5b = await runCase(
      'CASO 5 (EDGE) — Turno 2: paciente se rehúsa',
      h5Turn2,
      'Esa info es muy personal, no te la voy a dar.',
    )
    const h5Turn3: Message[] = [
      ...h5Turn2,
      { id: 'h6', conversation_id: 'demo', role: 'patient', content: 'Esa info es muy personal, no te la voy a dar.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
      { id: 'h7', conversation_id: 'demo', role: 'agent', content: r5b.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 5 (EDGE) — Turno 3: paciente sigue rehusándose', h5Turn3, 'Ya te dije, no quiero contestar.')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

  } finally {
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('Cleanup: desactivando regla + paciente/audit demo...')
    await supa.from('consultation_type_rules').delete()
      .eq('consultation_type_id', PRIMERA_VEZ_CT_ID)
      .eq('rule_type', 'patient_condition')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    await supa.from('audit_log').delete()
      .eq('clinic_id', ALGIA_CLINIC_ID)
      .eq('action', 'create_appointment_blocked_by_rule')
      .filter('details->>patient_phone', 'eq', DEMO_PHONE)
    console.log('Cleanup OK.')
  }
}

void CONTROL_CT_ID
main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
