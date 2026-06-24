/**
 * NIVEL C — Demostración de la regla age_limit (bloque 2) via conversaciones reales.
 *
 * Activa temporalmente la regla age_limit (18-50, below=rechazar, above=derivar)
 * para CONSULTA DE PRIMERA VEZ POR GINECOLOGÍA, corre 4 casos + 1 edge case
 * contra runAppointmentAgent (Claude real), imprime las respuestas, y desactiva
 * la regla al final.
 *
 * Cada caso pre-arma el historial hasta el momento DONDE el agente debería
 * llamar create_appointment, así vemos la regla actuar (sea por capa A —
 * el LLM detecta el marker y no llama el tool — o capa B — el tool lo
 * rechaza y el LLM relaya el mensaje).
 *
 * Casos:
 *   1. Dentro de rango (30 años) → agenda normal
 *   2. Bajo el mínimo (16 años, action=rechazar) → mensaje educado, no escala
 *   3. Sobre el máximo (62 años, action=derivar_humano) → deriva al staff
 *   4. Sin regla (otro CT) → flujo normal sin contaminación
 *   5. Edge: paciente no da fecha de nacimiento → deriva (safe default)
 *
 * Run: TZ=America/Bogota npx tsx scripts/demo-age-limit-conversations.ts
 * Filtro: --cases=1,2 para correr solo los indicados
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

if (existsSync('.env.local')) {
  const c = readFileSync('.env.local', 'utf-8')
  const match = c.split('\n').find((l) => l.trim().startsWith('ANTHROPIC_API_KEY='))
  if (match) {
    let v = match.slice(match.indexOf('=') + 1).trim()
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
const DEMO_PHONE = '+573008888888'
const DEMO_NAME = 'Paciente Demo Edad'

function isoDateForAge(age: number, today: Date = new Date()): string {
  const d = new Date(today)
  d.setFullYear(d.getFullYear() - age)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Construye un viernes futuro (próximo viernes a las 10am) para el slot
function getNextFridayISO(): { iso: string; readable: string } {
  const now = new Date()
  const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7
  const friday = new Date(now)
  friday.setDate(now.getDate() + daysUntilFriday)
  friday.setHours(10, 0, 0, 0)
  return { iso: friday.toISOString(), readable: 'el viernes' }
}

async function main(): Promise<void> {
  const clientMod = await import('../src/lib/anthropic/client')
  ;(clientMod.CLAUDE_CONFIG as unknown as { model: string }).model = 'claude-sonnet-4-6'
  console.log(`  Modelo override (solo demo): claude-sonnet-4-6`)

  const { runAppointmentAgent } = await import('../src/agents/appointment-agent')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Demo BLOQUE 2 (age_limit): regla 18-50, below=rechazar, above=derivar')
  console.log('═══════════════════════════════════════════════════════════════')

  console.log('\nSetup: activando regla en "CONSULTA DE PRIMERA VEZ POR GINECOLOGÍA"...')
  await supa.from('consultation_type_rules').delete()
    .eq('consultation_type_id', PRIMERA_VEZ_CT_ID)
    .eq('rule_type', 'age_limit')

  const { data: rule, error: ruleErr } = await supa
    .from('consultation_type_rules')
    .insert({
      consultation_type_id: PRIMERA_VEZ_CT_ID,
      clinic_id: ALGIA_CLINIC_ID,
      rule_type: 'age_limit',
      condition_config: {
        min: 18, max: 50,
        action_below_min: 'rechazar',
        action_above_max: 'derivar_humano',
      },
      action: 'rechazar',
      message: null,
      active: true,
    })
    .select('id')
    .single()
  if (ruleErr || !rule) { console.error('FATAL setup:', ruleErr); process.exit(1) }
  console.log(`  Regla activa: ${rule.id}`)

  await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)

  try {
    const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
    const { data: doctors } = await supa.from('doctors').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const { data: cts } = await supa.from('consultation_types').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const doctor = doctors!.find((d) => d.id === DOCTOR_JUAN_DIEGO_ID) ?? doctors![0]
    const waConfig = (clinicRow!.whatsapp_config as WhatsAppConfig) ?? null
    const friday = getNextFridayISO()

    async function runCase(
      label: string,
      messageHistory: Message[],
      patientMessage: string,
    ): Promise<{ text: string; tools: string[]; createdAppt: unknown }> {
      console.log('\n═══════════════════════════════════════════════════════════════')
      console.log(`  ${label}`)
      console.log('═══════════════════════════════════════════════════════════════')
      if (messageHistory.length > 0) {
        console.log('Historial previo:')
        for (const m of messageHistory) console.log(`  [${m.role}] ${m.content}`)
      }
      console.log(`\nPaciente: "${patientMessage}"`)

      const t0 = Date.now()
      const resp = await runAppointmentAgent({
        patientMessage,
        messageHistory,
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
      console.log(`Tools usadas: ${resp.toolsUsed.length === 0 ? '(ninguna)' : resp.toolsUsed.join(', ')}`)
      console.log(`Cita creada: ${resp.appointmentData ? '🔴 SÍ — ' + JSON.stringify(resp.appointmentData) : 'NO'}`)
      return { text: resp.text, tools: resp.toolsUsed, createdAppt: resp.appointmentData }
    }

    // runCaseTwoTurns: ejecuta turno 1, mete la respuesta del agente al historial,
    // ejecuta turno 2 con un mensaje de confirmación del paciente. Útil cuando
    // turno 1 hace check_availability y necesitamos llegar a create_appointment.
    async function runCaseTwoTurns(
      label: string,
      messageHistory: Message[],
      patientMessage1: string,
      patientMessage2: string,
    ): Promise<void> {
      // Turno 1
      const r1 = await runCase(label, messageHistory, patientMessage1)

      // Construir historial para turno 2
      const historialTurno2: Message[] = [
        ...messageHistory,
        {
          id: 'user-turn1', conversation_id: 'demo', role: 'patient',
          content: patientMessage1,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 30000).toISOString(),
        } as unknown as Message,
        {
          id: 'agent-turn1', conversation_id: 'demo', role: 'agent',
          content: r1.text,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 15000).toISOString(),
        } as unknown as Message,
      ]

      console.log('\n--- Turno 2 (paciente confirma horario propuesto) ---')
      await runCase(label + ' [Turno 2]', historialTurno2, patientMessage2)
    }

    // Buscar un slot REAL disponible para Juan Diego en los próximos días.
    // Crítico para que la conversación llegue a create_appointment sin trabarse
    // en SLOT_JUST_TAKEN por un slot inventado.
    async function findRealSlot(ctId: string): Promise<{ date: string; time: string; readable: string; dayName: string }> {
      const { executeTool } = await import('../src/agents/tools/executor')
      for (let i = 1; i <= 7; i++) {
        const d = new Date(); d.setDate(d.getDate() + i)
        const dateStr = d.toISOString().slice(0, 10)
        const res = await executeTool(
          'check_availability',
          { doctor_id: DOCTOR_JUAN_DIEGO_ID, consultation_type_id: ctId, preferred_date: dateStr },
          ALGIA_CLINIC_ID, clinicRow as Clinic, doctor as Doctor,
        )
        if (res.success && res.data) {
          const data = res.data as Record<string, unknown>
          const slots = (data.slots as Array<{ time: string; starts_at: string }> | undefined) ?? []
          if (slots.length > 0) {
            const dayName = (data.dayOfWeek as string) ?? ''
            const readable = `${dayName} ${d.getDate()} de ${d.toLocaleDateString('es-CO', { month: 'long', timeZone: 'America/Bogota' })}`
            return { date: dateStr, time: slots[0].time, readable, dayName }
          }
        }
      }
      throw new Error('No real slot found for Juan Diego in next 7 days')
    }

    // Helper para construir un historial estándar de "ya estamos por agendar".
    async function buildConfirmationHistory(
      paciente: { nombre: string; doc: string; docType: 'CC' | 'TI'; dob: string },
      tipoNombre: string,
      ctId: string,
    ): Promise<Message[]> {
      const dobReadable = ddmmyyyy(paciente.dob)
      const slot = await findRealSlot(ctId)
      console.log(`  → Slot real encontrado: ${slot.readable} a las ${slot.time}`)
      return [
        {
          id: 'h1', conversation_id: 'demo', role: 'patient',
          content: `Buenas tardes, quiero agendar ${tipoNombre.toLowerCase()} con el Dr. Juan Diego`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 300000).toISOString(),
        } as unknown as Message,
        {
          id: 'h2', conversation_id: 'demo', role: 'agent',
          content: 'Claro, con gusto te ayudo. Para agendar necesito tus datos en un solo mensaje: nombre completo, cédula, fecha de nacimiento, correo, dirección y modalidad de pago.',
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 240000).toISOString(),
        } as unknown as Message,
        {
          id: 'h3', conversation_id: 'demo', role: 'patient',
          content: `Mi nombre es ${paciente.nombre}, ${paciente.docType} ${paciente.doc}, fecha de nacimiento ${dobReadable}, micorreo@correo.com, vivo en Pereira, voy particular.`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 180000).toISOString(),
        } as unknown as Message,
        {
          id: 'h4', conversation_id: 'demo', role: 'agent',
          content: `Anotado ${paciente.nombre}. Tengo disponibilidad con el Dr. Juan Diego el ${slot.readable} a las ${slot.time}. ¿Te queda bien ese horario?`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 120000).toISOString(),
        } as unknown as Message,
        {
          id: 'h5', conversation_id: 'demo', role: 'patient',
          content: `Sí, a las ${slot.time} está perfecto.`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 60000).toISOString(),
        } as unknown as Message,
        {
          id: 'h6', conversation_id: 'demo', role: 'agent',
          content: `Te confirmo: ${tipoNombre} con el Dr. Juan Diego Villegas el ${slot.readable} a las ${slot.time}. ¿Confirmas que te agende?`,
          whatsapp_message_id: null, message_type: 'text', metadata: {},
          created_at: new Date(Date.now() - 30000).toISOString(),
        } as unknown as Message,
      ]
    }

    const casesArg = process.argv.find((a) => a.startsWith('--cases='))
    const casesToRun = casesArg ? casesArg.slice(8).split(',') : ['1', '2', '3', '4', '5']

    // ============================================================
    // Caso 1 — DENTRO de rango (30 años): agenda normal
    // ============================================================
    if (casesToRun.includes('1')) {
      const dob = isoDateForAge(30)
      const hist = await buildConfirmationHistory(
        { nombre: 'Laura Martínez', doc: '1234567890', docType: 'CC', dob },
        'consulta de primera vez por ginecología',
        PRIMERA_VEZ_CT_ID,
      )
      await runCaseTwoTurns(
        'CASO 1 — Edad DENTRO de rango (30 años, regla 18-50 activa)',
        hist,
        'Sí, confirmo, agéndamela.',
        'Sí, agéndame en esa hora.',
      )
      await supa.from('appointments').delete()
        .eq('clinic_id', ALGIA_CLINIC_ID)
        .filter('starts_at', 'gte', new Date(Date.now() - 3600000).toISOString())
        .filter('reason', 'ilike', '%Laura%')
      await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    }

    // ============================================================
    // Caso 2 — BAJO mínimo (16 años, action=rechazar): rechazo, NO escala
    // ============================================================
    if (casesToRun.includes('2')) {
      const dob = isoDateForAge(16)
      const hist = await buildConfirmationHistory(
        { nombre: 'Sofía Pérez', doc: '1099887766', docType: 'TI', dob },
        'consulta de primera vez por ginecología',
        PRIMERA_VEZ_CT_ID,
      )
      await runCaseTwoTurns(
        'CASO 2 — Edad BAJO mínimo (16 años, action=rechazar)',
        hist,
        'Sí, confírmamela.',
        'Sí, esa hora me sirve, agéndame.',
      )
      await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    }

    // ============================================================
    // Caso 3 — SOBRE máximo (62 años, action=derivar_humano): deriva
    // ============================================================
    if (casesToRun.includes('3')) {
      const dob = isoDateForAge(62)
      const hist = await buildConfirmationHistory(
        { nombre: 'Carmen Restrepo', doc: '22334455', docType: 'CC', dob },
        'consulta de primera vez por ginecología',
        PRIMERA_VEZ_CT_ID,
      )
      await runCaseTwoTurns(
        'CASO 3 — Edad SOBRE máximo (62 años, action=derivar_humano)',
        hist,
        'Sí, confirma por favor.',
        'Sí esa hora, agéndame por favor.',
      )
      await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    }

    // ============================================================
    // Caso 4 — paciente con edad fuera de rango (16) pero pide CT SIN regla
    // ============================================================
    if (casesToRun.includes('4')) {
      const dob = isoDateForAge(16)
      const hist = await buildConfirmationHistory(
        { nombre: 'Sofía Pérez', doc: '1099887766', docType: 'TI', dob },
        'consulta de control de seguimiento por ginecología',
        CONTROL_CT_ID,
      )
      await runCaseTwoTurns(
        'CASO 4 — Edad 16 años pero CONSULTA DE CONTROL (sin regla age_limit)',
        hist,
        'Sí, confirma.',
        'Sí, esa hora está bien, agéndame.',
      )
      await supa.from('appointments').delete()
        .eq('clinic_id', ALGIA_CLINIC_ID)
        .filter('starts_at', 'gte', new Date(Date.now() - 3600000).toISOString())
        .filter('reason', 'ilike', '%Sofía%')
      await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    }

    // ============================================================
    // Caso 5 — EDGE: paciente no quiere dar fecha de nacimiento
    // ============================================================
    if (casesToRun.includes('5')) {
      await runCase(
        'CASO 5 (EDGE) — Paciente se niega a dar fecha de nacimiento',
        [
          {
            id: 'h1', conversation_id: 'demo', role: 'patient',
            content: 'Quiero agendar una consulta de primera vez por ginecología con el Dr. Juan Diego',
            whatsapp_message_id: null, message_type: 'text', metadata: {},
            created_at: new Date(Date.now() - 240000).toISOString(),
          } as unknown as Message,
          {
            id: 'h2', conversation_id: 'demo', role: 'agent',
            content: 'Para agendarte necesito tus datos: nombre completo, cédula, fecha de nacimiento, correo, dirección y modalidad de pago.',
            whatsapp_message_id: null, message_type: 'text', metadata: {},
            created_at: new Date(Date.now() - 180000).toISOString(),
          } as unknown as Message,
          {
            id: 'h3', conversation_id: 'demo', role: 'patient',
            content: 'Mi nombre es Diana Gómez, CC 88776655, diana@correo.com, vivo en Pereira, particular. La fecha de nacimiento es información personal que prefiero no compartir.',
            whatsapp_message_id: null, message_type: 'text', metadata: {},
            created_at: new Date(Date.now() - 120000).toISOString(),
          } as unknown as Message,
          {
            id: 'h4', conversation_id: 'demo', role: 'agent',
            content: 'Necesito tu fecha de nacimiento en formato DD/MM/AAAA — por ejemplo 15/03/1990. Es indispensable para agendar.',
            whatsapp_message_id: null, message_type: 'text', metadata: {},
            created_at: new Date(Date.now() - 60000).toISOString(),
          } as unknown as Message,
        ],
        'No, esa información personal no la voy a dar. Agéndame igual.',
      )
      await supa.from('patients').delete().eq('clinic_id', ALGIA_CLINIC_ID).eq('phone', DEMO_PHONE)
    }

    void friday  // por si en futuro la usamos en runCase
  } finally {
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('Cleanup: desactivando regla + borrando paciente/audit demo...')
    await supa.from('consultation_type_rules').delete()
      .eq('consultation_type_id', PRIMERA_VEZ_CT_ID)
      .eq('rule_type', 'age_limit')
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
