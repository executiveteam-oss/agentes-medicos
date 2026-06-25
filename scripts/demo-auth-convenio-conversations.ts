/**
 * NIVEL C — Demo bloque 4 (requires_authorization) contra LLM en vivo.
 *
 * Activa regla auth_convenio para COLPOSCOPIA con lista
 * [SOS, MEDPLUS, COLMÉDICA, AXA COLPATRIA] en Algia.
 *
 * Casos:
 *   1. Paciente con SOS pide colposcopia → agente pide archivo (capa A)
 *   2. Paciente con Allianz pide colposcopia → flujo normal (no matchea)
 *   3. Paciente particular pide colposcopia → flujo normal (sin convenio)
 *   4. Paciente con SOS pide CT sin regla (control) → flujo normal
 *   5. EDGE — paciente envía el archivo (simulado), agente confirma + escala
 *
 * Adicionalmente: caso del feature flag OFF (default global) — el webhook
 * responde "solo texto, te paso con asesor" cuando recibe archivo. Eso se
 * documenta + se prueba con un test E2E del webhook directamente.
 *
 * Run: TZ=America/Bogota npx tsx scripts/demo-auth-convenio-conversations.ts
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
// COLPOSCOPIA (el primer CT que tenga "colposcopia" o uno común) — usamos
// el CT que el script encuentra. Si no hay, usa el CT de PRIMERA VEZ por gineco
// para tener algo agendable.
const DOCTOR_JUAN_DIEGO_ID = '97a20f5e-4aac-48d0-bef9-4240e666dca5'
const DEMO_PHONE = '+573006666666'
const DEMO_NAME = 'Paciente Demo Auth'

async function main(): Promise<void> {
  const clientMod = await import('../src/lib/anthropic/client')
  ;(clientMod.CLAUDE_CONFIG as unknown as { model: string }).model = 'claude-sonnet-4-6'
  console.log(`  Modelo override (demo): claude-sonnet-4-6`)

  const { runAppointmentAgent } = await import('../src/agents/appointment-agent')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Demo BLOQUE 4 (requires_authorization): SOS, MEDPLUS,')
  console.log('  COLMÉDICA, AXA COLPATRIA requieren autorización direccionada')
  console.log('═══════════════════════════════════════════════════════════════')

  // Buscar CT para la regla — preferimos uno que tenga "colpo" en el nombre
  // Usamos CONSULTA DE PRIMERA VEZ — un CT "simple" que NO tiene connotación
  // de "procedimiento quirúrgico" (biopsia/histeroscopia), porque el prompt
  // del bloque 1 hint sobre biopsias/histeroscopias hace que el LLM las escale
  // incluso sin la marca 🚨 explícita activada. Para validar el bloque 4
  // limpiamente, usamos un CT que no dispare esos hints.
  const { data: ctOptions } = await supa
    .from('consultation_types')
    .select('id, name, doctor_id, eps_name')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('is_active', true)
    .eq('doctor_id', DOCTOR_JUAN_DIEGO_ID)
    .ilike('name', '%PRIMERA VEZ%')
    .limit(1)
  type Row = { id: string; name: string; doctor_id: string; eps_name: string | null }
  const colposcopiaCt = (ctOptions?.[0] as Row | undefined) ?? null
  if (!colposcopiaCt) {
    console.error('FATAL: no encontré CT PRIMERA VEZ en Algia para el demo. Aborto.')
    process.exit(1)
  }
  const TARGET_CT_ID = colposcopiaCt.id
  console.log(`  CT target: ${colposcopiaCt.name} (${TARGET_CT_ID})`)

  // CT de control sin regla
  const { data: controlOptions } = await supa
    .from('consultation_types')
    .select('id, name')
    .eq('clinic_id', ALGIA_CLINIC_ID)
    .eq('is_active', true)
    .eq('doctor_id', DOCTOR_JUAN_DIEGO_ID)
    .ilike('name', '%control%')
    .limit(1)
  const controlCt = (controlOptions?.[0] as Row | undefined) ?? null
  const CONTROL_CT_ID = controlCt?.id
  console.log(`  CT control: ${controlCt?.name ?? '(none)'}`)

  console.log('\nSetup: limpiando reglas previas del CT y CT de control (para evitar contaminación entre bloques)...')
  // CRÍTICO: limpiar TODAS las reglas que pudieran haber quedado activas en
  // este CT de sesiones anteriores. Si quedó una escalate_human del bloque 1
  // en biopsia/histeroscopia, contamina los casos del bloque 4.
  await supa.from('consultation_type_rules').delete()
    .eq('consultation_type_id', TARGET_CT_ID)
  if (CONTROL_CT_ID) {
    await supa.from('consultation_type_rules').delete()
      .eq('consultation_type_id', CONTROL_CT_ID)
  }
  console.log('  Reglas previas eliminadas.')

  console.log('\nSetup: activando regla auth_convenio en CT target...')

  const { data: rule, error: ruleErr } = await supa.from('consultation_type_rules').insert({
    consultation_type_id: TARGET_CT_ID,
    clinic_id: ALGIA_CLINIC_ID,
    rule_type: 'requires_authorization',
    condition_config: {
      convenios_que_requieren: ['SOS', 'MEDPLUS', 'COLMÉDICA', 'AXA COLPATRIA'],
      message_pedir_archivo: 'Para {servicio} con {convenio} necesito que me envíes la autorización direccionada a la clínica. Mandala por aquí como foto o PDF y un asesor la revisa antes de agendarte.',
      match_mode: 'normalized_name',
    },
    action: 'derivar_humano',
    message: null,
    active: true,
  }).select('id').single()
  if (ruleErr || !rule) { console.error('FATAL setup:', ruleErr); process.exit(1) }
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

    function buildHistory(pacienteNombre: string, doc: string, modalidad: string, tipoNombre: string): Message[] {
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
          content: `Mi nombre es ${pacienteNombre}, CC ${doc}, fecha de nacimiento 15/03/1990, ${pacienteNombre.toLowerCase().replace(' ', '.')}@correo.com, vivo en Pereira, ${modalidad}.`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 60000).toISOString(),
        } as unknown as Message,
      ]
    }

    // ============================================================
    // Caso 1 — SOS pide colposcopia → agente PIDE archivo
    // ============================================================
    console.log('\n--- Caso 1: SOS pide colposcopia ---')
    const h1 = buildHistory('Andrea Martínez', '1234567890', 'tengo SOS EPS', colposcopiaCt.name)
    await runCase('CASO 1 — SOS pide colposcopia (regla activa)', h1, 'Mis datos están todos arriba.')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // ============================================================
    // Caso 2 — Allianz pide colposcopia → flujo normal
    // ============================================================
    console.log('\n--- Caso 2: Allianz (NO en lista) pide colposcopia ---')
    const h2 = buildHistory('Lucía Vargas', '2345678901', 'tengo Allianz', colposcopiaCt.name)
    await runCase('CASO 2 — Allianz pide colposcopia (no matchea)', h2, 'Mis datos están todos arriba.')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // ============================================================
    // Caso 3 — Particular pide colposcopia → flujo normal (sin convenio)
    // ============================================================
    console.log('\n--- Caso 3: Particular pide colposcopia ---')
    const h3 = buildHistory('Marta Castillo', '3456789012', 'voy particular', colposcopiaCt.name)
    await runCase('CASO 3 — Particular pide colposcopia', h3, 'Mis datos están todos arriba.')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

    // ============================================================
    // Caso 4 — SOS pero CT de control (sin regla)
    // ============================================================
    if (CONTROL_CT_ID) {
      console.log('\n--- Caso 4: SOS pide CT de control (sin regla) ---')
      const h4 = buildHistory('Sandra Pérez', '4567890123', 'tengo SOS EPS', controlCt!.name)
      await runCase('CASO 4 — SOS pide control (CT sin regla)', h4, 'Mis datos están todos arriba.')
      await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    }

    // ============================================================
    // Caso 5 — Continuación del caso 1: paciente envía el archivo
    // ============================================================
    console.log('\n--- Caso 5: SOS envió el archivo (simulado) ---')
    const h5Base = buildHistory('Andrea Martínez', '1234567890', 'tengo SOS EPS', colposcopiaCt.name)
    const r5a = await runCase(
      'CASO 5 — Turno 1: agente pide archivo (SOS + colposcopia)',
      h5Base,
      'Mis datos están todos arriba.',
    )
    const h5Turn2: Message[] = [
      ...h5Base,
      { id: 'h5a', conversation_id: 'demo', role: 'patient', content: 'Mis datos están todos arriba.', whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 60000).toISOString() } as unknown as Message,
      { id: 'h5b', conversation_id: 'demo', role: 'agent', content: r5a.text, whatsapp_message_id: null, message_type: 'text', metadata: {}, created_at: new Date(Date.now() - 30000).toISOString() } as unknown as Message,
    ]
    // Simulamos: el webhook procesó el archivo y agregó este mensaje al historial
    const h5Turn3: Message[] = [
      ...h5Turn2,
      { id: 'h5c', conversation_id: 'demo', role: 'patient', content: '📎 Autorización recibida', whatsapp_message_id: null, message_type: 'image', metadata: {}, created_at: new Date(Date.now() - 15000).toISOString() } as unknown as Message,
    ]
    await runCase('CASO 5 — Turno 2: paciente envió la autorización', h5Turn3, '📎 Autorización recibida')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

  } finally {
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('Cleanup: desactivando regla + paciente/audit demo...')
    await supa.from('consultation_type_rules').delete()
      .eq('consultation_type_id', TARGET_CT_ID)
      .eq('rule_type', 'requires_authorization')
    await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    await supa.from('audit_log').delete()
      .eq('clinic_id', ALGIA_CLINIC_ID)
      .eq('action', 'create_appointment_blocked_by_rule')
      .filter('details->>patient_phone', 'eq', DEMO_PHONE)
    console.log('Cleanup OK.')
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
  process.exit(1)
})
