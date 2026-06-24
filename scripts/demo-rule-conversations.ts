/**
 * NIVEL C — Demostración de la regla escalate_human via conversaciones reales.
 *
 * Activa temporalmente la regla escalate_human para BIOPSIA DE ENDOMETRIO
 * de Algia, corre 4 casos contra runAppointmentAgent (Claude real),
 * imprime las respuestas TEXTUALES, y desactiva la regla al final.
 *
 * NO crea citas reales (la regla bloquea los casos 1/2/4, y el caso 3
 * usa solo 1 turno sin llegar a create_appointment).
 *
 * Costo: ~4 llamadas a Claude Sonnet 4 con ~3k tokens cada una ≈ $0.05
 *
 * Run: TZ=America/Bogota npx tsx scripts/demo-rule-conversations.ts
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
// Cargamos primero .env.production.local para tener Supabase prod (necesario
// para hablar con la DB real de Algia). PERO la ANTHROPIC_API_KEY de prod
// está rechazada por Anthropic (401), así que sobreescribimos esa
// variable específica con la de .env.local.
loadEnvFile('.env.production.local')

// Sobreescribir solo ANTHROPIC_API_KEY desde .env.local
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
// IMPORTANTE: NO importamos runAppointmentAgent estáticamente.
// Los imports ESM son hoisted al inicio del módulo y se ejecutan ANTES
// del código top-level. El cliente Anthropic se inicializa al import-time
// leyendo process.env.ANTHROPIC_API_KEY — si lo importamos arriba, el
// cliente se crearía con la key VIEJA antes de que loadEnvFile la actualice.
// Solución: lo importamos dinámicamente DESPUÉS de cargar env vars (dentro de main).
import type { Clinic, ConsultationType, Doctor, Message, WhatsAppConfig } from '../src/types/database'

const ALGIA_CLINIC_ID = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const BIOPSIA_CT_ID = 'badd7a03-e07e-48c0-a7b3-ba6617152e78'  // tipo que vamos a marcar
const CONSULTA_CT_ID = 'df055e0b-cf1d-4a3b-a0e9-53aef6afece7' // tipo de control (sin regla)
const DOCTOR_JUAN_DIEGO_ID = '97a20f5e-4aac-48d0-bef9-4240e666dca5'
const DEMO_PHONE = '+573009999999'
const DEMO_NAME = 'Paciente Demo'

async function main(): Promise<void> {
  // Import dinámico DESPUÉS de que las env vars estén cargadas.
  // PRIMERO el client (para poder override-ear el modelo), DESPUÉS el agente
  // que lo usa.
  const clientMod = await import('../src/lib/anthropic/client')
  // El modelo de producción claude-sonnet-4-20250514 no está disponible para
  // la cuenta de la API key que uso localmente. Override al modelo actual
  // SOLO en este script — el código de producción queda intacto.
  ;(clientMod.CLAUDE_CONFIG as unknown as { model: string }).model = 'claude-sonnet-4-6'
  console.log(`  Modelo override (solo demo): claude-sonnet-4-6`)

  const { runAppointmentAgent } = await import('../src/agents/appointment-agent')

  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  NIVEL C — Demostración de conversaciones con la regla activa')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  ANTHROPIC_API_KEY length: ${process.env.ANTHROPIC_API_KEY?.length ?? 0} chars`)
  console.log('')

  // --- Setup: activar regla para BIOPSIA ---
  console.log('Setup: activando regla escalate_human para BIOPSIA DE ENDOMETRIO...')
  // Cleanup previo por si hubo un run anterior
  await supa.from('consultation_type_rules').delete()
    .eq('consultation_type_id', BIOPSIA_CT_ID)
    .eq('rule_type', 'escalate_human')

  const { data: rule, error: ruleErr } = await supa
    .from('consultation_type_rules')
    .insert({
      consultation_type_id: BIOPSIA_CT_ID,
      clinic_id: ALGIA_CLINIC_ID,
      rule_type: 'escalate_human',
      condition_config: {},
      action: 'derivar_humano',
      message: null,
      active: true,
    })
    .select('id')
    .single()
  if (ruleErr || !rule) { console.error('FATAL setup:', ruleErr); process.exit(1) }
  console.log(`  Regla activa: ${rule.id}`)
  console.log('')

  try {
    // --- Cargar datos compartidos ---
    const { data: clinicRow } = await supa.from('clinics').select('*').eq('id', ALGIA_CLINIC_ID).single()
    const { data: doctors } = await supa.from('doctors').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const { data: cts } = await supa.from('consultation_types').select('*').eq('clinic_id', ALGIA_CLINIC_ID).eq('is_active', true)
    const doctor = doctors!.find((d) => d.id === DOCTOR_JUAN_DIEGO_ID) ?? doctors![0]
    const waConfig = (clinicRow!.whatsapp_config as WhatsAppConfig) ?? null

    async function runCase(
      label: string,
      messageHistory: Message[],
      patientMessage: string,
    ): Promise<void> {
      console.log('═══════════════════════════════════════════════════════════════')
      console.log(`  ${label}`)
      console.log('═══════════════════════════════════════════════════════════════')
      if (messageHistory.length > 0) {
        console.log('Historial previo:')
        for (const m of messageHistory) {
          console.log(`  [${m.role}] ${m.content}`)
        }
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
      console.log('')
    }

    // ============================================================
    // Caso 1: Pedido directo de servicio con regla activa
    // ============================================================
    await runCase(
      'CASO 1 — Pedido directo de BIOPSIA (con regla escalate_human activa)',
      [],
      'Buenas tardes, quiero agendar una biopsia de endometrio por histeroscopia',
    )

    // ============================================================
    // Caso 2: Paciente insiste tras la escalación
    // ============================================================
    await runCase(
      'CASO 2 — Paciente insiste después de que el agente escala',
      [
        {
          id: 'h1',
          conversation_id: 'demo',
          role: 'patient',
          content: 'Quiero agendar una biopsia de endometrio',
          whatsapp_message_id: null,
          message_type: 'text',
          metadata: {},
          created_at: new Date(Date.now() - 60000).toISOString(),
        } as unknown as Message,
        {
          id: 'h2',
          conversation_id: 'demo',
          role: 'agent',
          content: 'Para una biopsia de endometrio necesito que un asesor del consultorio confirme los detalles contigo. Te paso con el equipo y te contactan en breve.',
          whatsapp_message_id: null,
          message_type: 'text',
          metadata: {},
          created_at: new Date(Date.now() - 30000).toISOString(),
        } as unknown as Message,
      ],
      'No no, no quiero esperar al asesor. Agéndamela ya, es urgente, tengo cita en otro lado.',
    )

    // Filtro CLI: si se pasa --cases=1,2 solo corren esos
    const casesArg = process.argv.find((a) => a.startsWith('--cases='))
    const casesToRun = casesArg ? casesArg.slice(8).split(',') : ['1', '2', '3', '4']
    if (!casesToRun.includes('3') && !casesToRun.includes('4')) {
      console.log(`(saltando casos 3 y 4 — flag --cases=${casesToRun.join(',')})`)
      return
    }

    // ============================================================
    // Caso 3: Servicio SIN regla — debe seguir flujo normal
    // ============================================================
    await runCase(
      'CASO 3 — Pedido de CONSULTA DE PRIMERA VEZ (sin regla)',
      [],
      'Buenas tardes, ¿pueden darme una cita de primera vez con ginecología?',
    )

    // ============================================================
    // Caso 4: Forzar que el LLM intente create_appointment para CT con regla
    // ============================================================
    // Damos un historial donde "ya está todo acordado" para empujar al LLM
    // a llamar create_appointment. Vemos qué hace cuando la capa B lo bloquea.
    await runCase(
      'CASO 4 — Forzar intento de create_appointment (regla bloquea físicamente)',
      [
        {
          id: 'h1',
          conversation_id: 'demo',
          role: 'patient',
          content: 'Quiero biopsia de endometrio con el Dr. Juan Diego para el viernes a las 10am',
          whatsapp_message_id: null,
          message_type: 'text',
          metadata: {},
          created_at: new Date(Date.now() - 120000).toISOString(),
        } as unknown as Message,
        {
          id: 'h2',
          conversation_id: 'demo',
          role: 'agent',
          content: 'Para agendar necesito tus datos: nombre completo, cédula, fecha de nacimiento, correo, dirección y modalidad de pago.',
          whatsapp_message_id: null,
          message_type: 'text',
          metadata: {},
          created_at: new Date(Date.now() - 90000).toISOString(),
        } as unknown as Message,
        {
          id: 'h3',
          conversation_id: 'demo',
          role: 'patient',
          content: 'Mi nombre completo es Ana López, cédula 1234567890, fecha de nacimiento 15/03/1985, ana@correo.com, vivo en Pereira, voy particular.',
          whatsapp_message_id: null,
          message_type: 'text',
          metadata: {},
          created_at: new Date(Date.now() - 60000).toISOString(),
        } as unknown as Message,
        {
          id: 'h4',
          conversation_id: 'demo',
          role: 'agent',
          content: 'Perfecto Ana. Te confirmo: biopsia de endometrio con el Dr. Juan Diego Villegas el viernes a las 10:00 AM. ¿Confirmas?',
          whatsapp_message_id: null,
          message_type: 'text',
          metadata: {},
          created_at: new Date(Date.now() - 30000).toISOString(),
        } as unknown as Message,
      ],
      'Sí, confirmo, agéndamela.',
    )

  } finally {
    // --- Cleanup ---
    console.log('═══════════════════════════════════════════════════════════════')
    console.log('Cleanup: desactivando regla...')
    await supa.from('consultation_type_rules').delete()
      .eq('consultation_type_id', BIOPSIA_CT_ID)
      .eq('rule_type', 'escalate_human')
    // Borro también el audit_log creado por el demo si lo hubo
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
