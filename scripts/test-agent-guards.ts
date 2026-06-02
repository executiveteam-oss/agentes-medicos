/**
 * Tests de los guards anti-alucinación del agente WhatsApp.
 * Run: npx tsx scripts/test-agent-guards.ts
 *
 * Cubre los 4 guards:
 *   1. Identidad confirmada fabricada (bug Lady León — Algia, junio 2026)
 *   2. Cancelación fabricada
 *   3. Reagendamiento fabricado
 *   4. Cita confirmada sin appointmentData
 *
 * NO requiere DB ni red — funciones puras.
 */

import {
  detectHallucinatedAppointmentConfirmation,
  detectHallucinatedCancellation,
  detectHallucinatedIdentity,
  detectHallucinatedReschedule,
} from '../src/lib/whatsapp/agent-guards'
import type { Message } from '../src/types/database'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

function msg(role: 'patient' | 'agent', content: string): Message {
  return {
    id: `msg-${Math.random()}`,
    conversation_id: 'conv-1',
    role,
    content,
    whatsapp_message_id: null,
    message_type: 'text',
    metadata: {},
    created_at: new Date().toISOString(),
  } as Message
}

// ============================================================
// GUARD 1 — Identidad fabricada
// ============================================================
function testIdentityGuard() {
  console.log('\n=== Guard 1: Identidad confirmada fabricada ===')

  // CASO REAL DEL BUG (Lady León / Algia):
  // 1. Lady envió "BUEN DÍA"
  // 2. Agente: "¡Hola Lady León! ¿Confirmas que eres Lady León, CC 42126898...?"
  // 3. Lady envió "para pedir una cita"
  // 4. Agente: "¡Perfecto! Como ya confirmaste tus datos, vamos directo al agendamiento."
  // ESPERADO: bloquear el mensaje 4.
  {
    const history: Message[] = [
      msg('patient', 'BUEN DÍA'),
      msg('agent', '¡Hola Lady León! 👋 Veo que ya eres paciente nuestro. ¿Confirmas que eres Lady León, CC 42126898, afiliado/a a Coomeva? Responde Sí para continuar o No si algo cambió.'),
    ]
    const result = detectHallucinatedIdentity({
      agentText: '¡Perfecto! Como ya confirmaste tus datos, vamos directo al agendamiento. ¿Qué tipo de consulta necesitas?',
      messageHistory: history,
      currentPatientMsg: 'para pedir una cita',
      patientName: 'Lady León',
      patientDocType: 'CC',
      patientDocNumber: '42126898',
    })
    assert('Bug Lady León: bloquea "Como ya confirmaste" sin afirmación', result.blocked, JSON.stringify(result))
    assert('  Replacement pide confirmación con nombre+CC', !!result.replacement?.includes('Lady León') && !!result.replacement?.includes('CC 42126898'))
  }

  // VARIANTES DEL CLAIM — todas deben bloquearse
  for (const claim of [
    'Perfecto, ya confirmaste tus datos. Vamos a agendar.',
    'Gracias por confirmar. ¿Qué día prefieres?',
    'Una vez confirmada tu identidad, te muestro horarios.',
    'Tus datos confirmados. Procedo a agendar.',
    'Identidad confirmada ✅',
  ]) {
    const result = detectHallucinatedIdentity({
      agentText: claim,
      messageHistory: [msg('agent', '¿Confirmas que eres Juan Pérez, CC 123?')],
      currentPatientMsg: 'para pedir una cita',
      patientName: 'Juan Pérez',
      patientDocType: 'CC',
      patientDocNumber: '123',
    })
    assert(`Bloquea variante: "${claim.slice(0, 40)}..."`, result.blocked)
  }

  // CASO LEGÍTIMO: paciente afirmó "sí" tras la pregunta
  {
    const history: Message[] = [
      msg('patient', 'hola'),
      msg('agent', '¿Confirmas que eres Lady León, CC 42126898?'),
      msg('patient', 'sí'),
    ]
    const result = detectHallucinatedIdentity({
      agentText: 'Perfecto, ya confirmaste tus datos. ¿Qué tipo de consulta necesitas?',
      messageHistory: history,
      currentPatientMsg: 'quiero agendar',
      patientName: 'Lady León',
      patientDocType: 'CC',
      patientDocNumber: '42126898',
    })
    assert('NO bloquea si paciente respondió "sí" en historial', !result.blocked)
  }

  // VARIANTES DE AFIRMACIÓN VÁLIDA
  for (const affirmation of ['sí', 'si', 'Sí', 'SÍ', 'correcto', 'dale', 'ok', 'listo', 'confirmo', 'claro', 'así es', 'esa soy', 'Sí, soy yo']) {
    const history: Message[] = [
      msg('agent', '¿Confirmas que eres Juan?'),
      msg('patient', affirmation),
    ]
    const result = detectHallucinatedIdentity({
      agentText: 'Perfecto, ya confirmaste. Te agendo.',
      messageHistory: history,
      currentPatientMsg: 'sí',
      patientName: 'Juan',
    })
    assert(`Acepta afirmación: "${affirmation}"`, !result.blocked)
  }

  // CASO LEGÍTIMO: el agente NO hizo claim de confirmación
  {
    const result = detectHallucinatedIdentity({
      agentText: '¡Hola! ¿Confirmas que eres Juan, CC 123?',
      messageHistory: [msg('patient', 'hola')],
      currentPatientMsg: 'hola',
      patientName: 'Juan',
    })
    assert('NO bloquea pregunta legítima de confirmación', !result.blocked)
  }

  // FALSOS POSITIVOS — no debe bloquear
  for (const safe of [
    '¡Hola! ¿Confirmas que eres Lady León?',
    'Necesito que confirmes tu identidad antes de agendar.',
    '¿Confirmas la cita para mañana?',
    'Para cancelar tu cita, primero confirmas que eres tú.',
  ]) {
    const result = detectHallucinatedIdentity({
      agentText: safe,
      messageHistory: [],
      currentPatientMsg: 'hola',
      patientName: 'Lady',
    })
    assert(`NO bloquea texto seguro: "${safe.slice(0, 50)}..."`, !result.blocked)
  }

  // MENSAJES DEL PACIENTE QUE NO CUENTAN COMO AFIRMACIÓN
  for (const notAffirmation of ['para pedir una cita', 'necesito agendar', 'quiero una cita', 'hola', 'cuánto cuesta']) {
    const history: Message[] = [
      msg('agent', '¿Confirmas que eres Juan?'),
      msg('patient', notAffirmation),
    ]
    const result = detectHallucinatedIdentity({
      agentText: 'Perfecto, ya confirmaste. Te agendo.',
      messageHistory: history,
      currentPatientMsg: notAffirmation,
      patientName: 'Juan',
    })
    assert(`Detecta no-afirmación: "${notAffirmation}"`, result.blocked)
  }
}

// ============================================================
// GUARD 2 — Cancelación fabricada
// ============================================================
function testCancellationGuard() {
  console.log('\n=== Guard 2: Cancelación fabricada ===')

  // CLAIMS DE CANCELACIÓN sin tool
  for (const claim of [
    '✅ Tu cita ha sido cancelada.',
    'Tu cita está cancelada. ¿Quieres agendar otra?',
    'Cancelé tu cita para el martes.',
    'Tu cita quedó cancelada.',
    'Listo, tu cita ha sido anulada.',
  ]) {
    const result = detectHallucinatedCancellation({ agentText: claim, toolsUsed: [] })
    assert(`Bloquea cancelación fabricada: "${claim.slice(0, 50)}..."`, result.blocked)
  }

  // CON tool cancel_appointment → no bloquear
  {
    const result = detectHallucinatedCancellation({
      agentText: '✅ Tu cita ha sido cancelada.',
      toolsUsed: ['cancel_appointment'],
    })
    assert('NO bloquea cancelación con tool ejecutada', !result.blocked)
  }

  // FALSOS POSITIVOS
  for (const safe of [
    'Si necesitas cancelar, escríbenos con anticipación.',
    'Para cancelar, dime qué cita quieres cancelar.',
    '¿Quieres cancelar tu cita?',
  ]) {
    const result = detectHallucinatedCancellation({ agentText: safe, toolsUsed: [] })
    assert(`NO bloquea texto seguro: "${safe.slice(0, 50)}..."`, !result.blocked)
  }
}

// ============================================================
// GUARD 3 — Reagendamiento fabricado
// ============================================================
function testRescheduleGuard() {
  console.log('\n=== Guard 3: Reagendamiento fabricado ===')

  for (const claim of [
    '✅ Tu cita ha sido reagendada para el jueves.',
    'Tu cita quedó reprogramada para las 3 PM.',
    'Reagendé tu cita.',
    'Reprogramé tu cita para mañana.',
  ]) {
    const result = detectHallucinatedReschedule({ agentText: claim, toolsUsed: [] })
    assert(`Bloquea reagendamiento fabricado: "${claim.slice(0, 50)}..."`, result.blocked)
  }

  // CON tool → no bloquear
  for (const tools of [['reschedule_appointment'], ['create_appointment'], ['cancel_appointment', 'create_appointment']]) {
    const result = detectHallucinatedReschedule({
      agentText: '✅ Tu cita ha sido reagendada.',
      toolsUsed: tools,
    })
    assert(`NO bloquea reagendamiento con tools [${tools.join(',')}]`, !result.blocked)
  }

  // FALSOS POSITIVOS
  for (const safe of [
    '¿Quieres reagendar tu cita?',
    'Para reagendar, dime el nuevo horario.',
  ]) {
    const result = detectHallucinatedReschedule({ agentText: safe, toolsUsed: [] })
    assert(`NO bloquea texto seguro: "${safe.slice(0, 50)}..."`, !result.blocked)
  }
}

// ============================================================
// GUARD 4 — Cita confirmada sin appointmentData
// ============================================================
function testAppointmentConfirmationGuard() {
  console.log('\n=== Guard 4: Cita confirmada fabricada ===')

  // Sin appointmentData → bloquear
  for (const claim of [
    '✅ Cita confirmada con Dr. Juan el martes 15.',
    '✅ Cita agendada para las 3 PM.',
    '✅ Cita creada con éxito.',
  ]) {
    const result = detectHallucinatedAppointmentConfirmation({
      agentText: claim,
      hasAppointmentData: false,
      toolsUsed: [],
    })
    assert(`Bloquea sin appointmentData: "${claim.slice(0, 50)}..."`, result.blocked)
  }

  // Con appointmentData → no bloquear
  {
    const result = detectHallucinatedAppointmentConfirmation({
      agentText: '✅ Cita confirmada con Dr. Juan.',
      hasAppointmentData: true,
      toolsUsed: ['create_appointment'],
    })
    assert('NO bloquea con appointmentData válida', !result.blocked)
  }

  // Texto sin ✅ + "cita confirmada" → no aplica
  {
    const result = detectHallucinatedAppointmentConfirmation({
      agentText: 'Listo, te agendo.',
      hasAppointmentData: false,
      toolsUsed: [],
    })
    assert('NO bloquea texto sin claim de confirmación', !result.blocked)
  }
}

// ============================================================
// MAIN
// ============================================================
function main() {
  console.log('🧪 Tests de guards anti-alucinación')
  console.log('====================================')

  testIdentityGuard()
  testCancellationGuard()
  testRescheduleGuard()
  testAppointmentConfirmationGuard()

  console.log(`\n${passed} pasaron · ${failed} fallaron`)
  if (failed > 0) process.exit(1)
}

main()
