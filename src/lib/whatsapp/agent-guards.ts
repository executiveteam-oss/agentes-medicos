// ============================================================
// Guards defensivos para detectar alucinaciones del agente
//
// Cada guard detecta cuando el agente afirma algo que NO ocurrió:
// - Identidad confirmada sin afirmación explícita del paciente
// - Cita cancelada sin haber llamado cancel_appointment
// - Cita reagendada sin haber llamado reschedule_appointment
// - Cita confirmada sin appointmentData válida
//
// Funciones puras → testeables sin DB/network.
// ============================================================

import type { Message } from '@/types/database'

// ============================================================
// Regex compartidos
// ============================================================

// Frases que CLAIMAN identidad confirmada
export const IDENTITY_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bya\s+(que\s+)?(confirmaste|confirmamos|confirmas)\b/i,
  /\bcomo\s+(ya\s+)?(confirmaste|confirmados?)\b/i,
  /\b(datos|identidad)\s+confirmad[oa]s?\b/i,
  /\bconfirmad[oa]\s+(tu|tus)\s+(identidad|datos)\b/i,
  /\bgracias\s+por\s+confirmar\b/i,
  /\buna\s+vez\s+confirmad[oa]/i,
]

// Detecta cuando el AGENTE preguntó por confirmación
export const AGENT_REQUESTED_CONFIRMATION = /confirmas\s+que\s+eres|¿confirmas\??|responde\s+s[ií]\s+para|¿eres\s+[A-ZÁÉÍÓÚÑ]/i

// Mensaje del PACIENTE que cuenta como afirmación explícita
// (mensaje entero o que empieza con sí + puntuación)
export const PATIENT_AFFIRMATION = /^\s*(s[ií]|si|yes|correcto|exacto|exactamente|dale|claro|ok(?:ey)?|listo|sip|confirmo|af[ií]rmativo|as[ií]\s+es|esa\s+soy|ese\s+soy|soy\s+yo|todo\s+correcto|conforme|de\s+acuerdo)\s*[!.,]?\s*$/i
export const PATIENT_AFFIRMATION_PREFIX = /^\s*(s[ií]|si)\b[\s,.!]/i

// Frases que CLAIMAN cancelación
export const CANCELLATION_CLAIM = /\bcita\b[^.!?]{0,40}\b(cancelad[ao]|anulad[ao])\b|\bcancel[ée]\s+tu\s+cita\b|\bcita\s+(qued[ao]|est[áa])\s+cancelad/i

// Frases que CLAIMAN reagendamiento
export const RESCHEDULE_CLAIM = /\bcita\b[^.!?]{0,40}\b(reagendad[ao]|reprogramad[ao])\b|\b(reagend[ée]|reprogram[ée])\s+tu\s+cita\b|\bcita\s+(qued[ao]|est[áa])\s+(reagendad|reprogramad)/i

// Frases que CLAIMAN cita creada/confirmada (formato con ✅)
export const APPOINTMENT_CONFIRMATION_CLAIM = /✅.*cita (confirmada|agendada|creada)/i

// ============================================================
// Resultado común
// ============================================================
export interface GuardResult {
  blocked: boolean
  replacement?: string
  reason?: string
  details?: Record<string, unknown>
}

// ============================================================
// GUARD 1: Identidad confirmada fabricada
// ============================================================
export function detectHallucinatedIdentity(args: {
  agentText: string
  messageHistory: Message[]
  currentPatientMsg: string
  patientName: string
  patientDocType?: string | null
  patientDocNumber?: string | null
}): GuardResult {
  const { agentText, messageHistory, currentPatientMsg, patientName, patientDocType, patientDocNumber } = args

  const claimsConfirmed = IDENTITY_CLAIM_PATTERNS.some((r) => r.test(agentText))
  if (!claimsConfirmed) return { blocked: false }

  // Buscar última solicitud de confirmación del agente en historial
  let lastConfirmRequestIdx = -1
  messageHistory.forEach((m, i) => {
    if (m.role === 'agent' && AGENT_REQUESTED_CONFIRMATION.test(m.content)) {
      lastConfirmRequestIdx = i
    }
  })

  // Recopilar mensajes del paciente DESPUÉS de la solicitud + el actual
  const subsequentPatientMsgs: string[] = []
  if (lastConfirmRequestIdx >= 0) {
    for (let i = lastConfirmRequestIdx + 1; i < messageHistory.length; i++) {
      if (messageHistory[i].role === 'patient') subsequentPatientMsgs.push(messageHistory[i].content)
    }
  }
  subsequentPatientMsgs.push(currentPatientMsg)

  // ¿Alguno fue afirmación explícita?
  const explicitConfirmation = subsequentPatientMsgs.some((m) => {
    const t = m.trim()
    return PATIENT_AFFIRMATION.test(t) || PATIENT_AFFIRMATION_PREFIX.test(t)
  })

  if (explicitConfirmation) return { blocked: false }

  const docInfo = patientDocType && patientDocNumber ? `, ${patientDocType} ${patientDocNumber}` : ''
  return {
    blocked: true,
    replacement: `Antes de continuar necesito que confirmes tu identidad. ¿Eres ${patientName}${docInfo}? Respóndeme "sí" o "no" para seguir.`,
    reason: 'hallucinated_identity_confirmation',
    details: {
      last_patient_messages: subsequentPatientMsgs.slice(-3).map((s) => s.slice(0, 80)),
      had_confirm_request_in_history: lastConfirmRequestIdx >= 0,
    },
  }
}

// ============================================================
// GUARD 2: Cancelación fabricada
// ============================================================
export function detectHallucinatedCancellation(args: {
  agentText: string
  toolsUsed: string[]
}): GuardResult {
  if (!CANCELLATION_CLAIM.test(args.agentText)) return { blocked: false }
  if (args.toolsUsed.includes('cancel_appointment')) return { blocked: false }
  return {
    blocked: true,
    replacement: 'Disculpa, tuve un problema procesando la cancelación. ¿Me confirmas qué cita quieres cancelar?',
    reason: 'hallucinated_cancellation',
    details: { tools_used: args.toolsUsed },
  }
}

// ============================================================
// GUARD 3: Reagendamiento fabricado
// ============================================================
export function detectHallucinatedReschedule(args: {
  agentText: string
  toolsUsed: string[]
}): GuardResult {
  if (!RESCHEDULE_CLAIM.test(args.agentText)) return { blocked: false }
  // reschedule_appointment O create_appointment (algunos flujos crean nueva en vez de reagendar)
  if (args.toolsUsed.includes('reschedule_appointment') || args.toolsUsed.includes('create_appointment')) {
    return { blocked: false }
  }
  return {
    blocked: true,
    replacement: 'Disculpa, tuve un problema procesando el reagendamiento. ¿Me confirmas el nuevo horario que prefieres?',
    reason: 'hallucinated_reschedule',
    details: { tools_used: args.toolsUsed },
  }
}

// ============================================================
// GUARD 4: Cita confirmada fabricada (sin appointmentData)
// ============================================================
export function detectHallucinatedAppointmentConfirmation(args: {
  agentText: string
  hasAppointmentData: boolean
  toolsUsed: string[]
}): GuardResult {
  if (!APPOINTMENT_CONFIRMATION_CLAIM.test(args.agentText)) return { blocked: false }
  if (args.hasAppointmentData) return { blocked: false }
  return {
    blocked: true,
    replacement: 'Disculpa, hubo un problema técnico al confirmar tu cita. ¿Puedes intentar de nuevo diciendo el horario que prefieres?',
    reason: 'hallucinated_appointment_confirmation',
    details: { tools_used: args.toolsUsed },
  }
}
