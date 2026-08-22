// ============================================================
// EL CORTE POR CONVERSACIÓN ESCALADA — ¿el agente responde o se calla?
//
// Hasta el 2026-08-22 esta pregunta tenía una sola respuesta: `status ===
// 'escalated'` ⇒ el agente se calla. Simple, y equivocada en la mitad de los
// casos — porque mezcla dos situaciones que no se parecen en nada:
//
//   1. Una persona del equipo YA está contestando. Que el agente hable ahí es
//      pisarla: dos voces, dos versiones, y la paciente sin saber a quién
//      creerle. Esa garantía no se toca.
//
//   2. NADIE del equipo abrió nunca la conversación. Acá no hay a quién pisar,
//      y el corte no protege nada: sólo produce silencio. Lo medimos —
//      una paciente con orden de oncólogo escribió seis veces en 32 horas y no
//      recibió una sola respuesta, porque su conversación estaba "escalada"
//      esperando a alguien que nunca llegó.
//
// La distinción es un HECHO consultable, no una interpretación: ¿existe algún
// mensaje `role='staff'` en esta conversación? Si existe, hay un humano
// adentro. Si no existe, el silencio no protege a nadie.
//
// 🔴 PERO NO TODO SE DESTRABA IGUAL, y esta es la parte que importa.
//
// Que no haya humano NO alcanza para que el agente hable. Hay escalaciones
// donde el agente no puede resolver nada y hablar sería peor que callar:
// una crisis, un derecho ARCO, una paciente que pidió expresamente una
// persona. Ahí el silencio del agente no es un bug — es la respuesta correcta,
// y lo que falta es que alguien atienda, no que el bot improvise.
//
// Sólo se destraban los motivos donde el agente PUEDE resolver de verdad:
// fallas técnicas nuestras, archivos recibidos, datos que nos faltaban. Y en
// el caso del servicio ruleado, se destraba la CONVERSACIÓN pero no la
// ACCIÓN: puede informar, responder dudas y acusar recibo, y el backstop del
// executor le sigue bloqueando `create_appointment` para ese servicio
// (BLOCKED_BY_RULE_ESCALATE_HUMAN). Eso es capa B y no depende de este archivo.
//
// Esta función es PURA a propósito: la decisión que le deja el bot a una
// paciente o se lo saca no puede depender de leer bien tres campos en medio de
// un webhook de 2.000 líneas. Se testea sin DB, con la tabla de la verdad
// completa (scripts/test-corte-por-escalada.ts).
// ============================================================

import { ESCALATION_REASONS, isKnownReason, type EscalationReason } from './escalation-reasons'

/**
 * Los motivos que NO se destraban NUNCA, aunque nadie del equipo haya
 * contestado. En todos, la respuesta correcta es una persona — no un bot que
 * lo intente otra vez.
 *
 * Agregar un motivo acá es SEGURO (más silencio). Sacarlo es la decisión
 * peligrosa: hay que poder decir qué es lo que el agente resuelve en ese caso.
 */
export const MOTIVOS_RESERVADOS_A_HUMANO: ReadonlySet<EscalationReason> = new Set([
  // — Capa 0: son garantías, no consultas. El agente no tiene nada que aportar. —
  ESCALATION_REASONS.CRISIS,            // una persona en riesgo no habla con un bot
  ESCALATION_REASONS.DATA_RIGHTS,       // obligación legal (Ley 1581) con runbook humano
  ESCALATION_REASONS.HUMAN_REQUEST,     // pidió una persona: dársela es el punto

  // — La clínica puso esa palabra en la lista JUSTAMENTE para sacar al bot. —
  ESCALATION_REASONS.KEYWORD,

  // — El modelo mismo dijo "no puedo con esto". Volver a soltarlo sobre el
  //   mismo caso es esperar un resultado distinto del mismo intento. —
  ESCALATION_REASONS.AGENT_TOOL,
  ESCALATION_REASONS.AGENT_REESCALATED,

  // — La clínica no está operando: no hay agenda que ofrecer. —
  ESCALATION_REASONS.CLINIC_NOT_OPERATING,

  // — Una persona la sacó del agente a propósito desde el dashboard. Que
  //   todavía no haya escrito no anula la decisión de haberla tomado. —
  ESCALATION_REASONS.STAFF_TAKEOVER,
  ESCALATION_REASONS.STAFF_ASSIGNED,
  ESCALATION_REASONS.STAFF_MANUAL,
])

/**
 * Motivos donde el agente conversa pero NO puede cerrar el trámite solo.
 * No cambia la decisión de hablar — cambia lo que se le dice al modelo y lo
 * que se espera del turno. El bloqueo real vive en el executor.
 */
export const MOTIVOS_CON_ACCION_BLOQUEADA: ReadonlySet<EscalationReason> = new Set([
  ESCALATION_REASONS.SERVICE_RULE,          // puede informar; agendar ese servicio no
  ESCALATION_REASONS.AUTHORIZATION_REVIEW,  // la autorización la valida una persona
])

export type PorQueSeCalla =
  | 'humano_ya_respondio'
  | 'motivo_reservado_a_humano'
  | 'motivo_desconocido'

export interface DecisionDeCorte {
  /** true = el turno sigue su curso normal (agente incluido). */
  atiende: boolean
  /** Sólo cuando `atiende` es false. */
  porque?: PorQueSeCalla
  /** El motivo leído del context, o null si no había uno del conjunto cerrado. */
  motivo: EscalationReason | null
  /** El agente puede conversar pero el executor le va a bloquear la acción. */
  accionBloqueada: boolean
}

export interface EntradaDelCorte {
  /** `conversations.status` tal cual. */
  status: string
  /** `conversations.context.escalation_reason` tal cual (puede ser cualquier cosa). */
  escalationReason: unknown
  /**
   * ¿Hay una persona atendiendo esta conversación?
   *
   * 🔴 NO se calcula acá y NO se calcula a mano en el call site: sale de
   * `huboIntervencionHumana` (src/lib/conversations/intervencion-humana.ts),
   * que es la MISMA función con la que la bandeja decide mostrar "nadie
   * respondió". Mientras fueron dos criterios divergían en 9 de 72
   * conversaciones — la pantalla decía que nadie había contestado y el corte
   * las trataba como atendidas, dejándolas en silencio.
   */
  huboRespuestaHumana: boolean
}

/**
 * La única función que responde "¿el agente habla en esta conversación?".
 *
 * No escribe, no consulta, no notifica: decide. Todo lo que pasa después
 * —refrescar la alerta, subirla a Atención, dejar el registro de cobertura—
 * es responsabilidad del webhook y ocurre igual en las dos ramas.
 */
export function decidirCorteDeEscalada(e: EntradaDelCorte): DecisionDeCorte {
  const motivo = isKnownReason(e.escalationReason) ? e.escalationReason : null
  const accionBloqueada = motivo !== null && MOTIVOS_CON_ACCION_BLOQUEADA.has(motivo)

  // No está escalada: el corte ni siquiera aplica.
  if (e.status !== 'escalated') return { atiende: true, motivo, accionBloqueada }

  // Hay un humano adentro. Esta rama es la garantía vieja y no se toca.
  if (e.huboRespuestaHumana) {
    return { atiende: false, porque: 'humano_ya_respondio', motivo, accionBloqueada }
  }

  // Escalada sin motivo del conjunto cerrado: no sabemos qué la causó, así que
  // no podemos afirmar que el agente pueda resolverla. Ante la duda, silencio
  // — el mismo sesgo seguro que usa el resto del sistema.
  if (motivo === null) {
    return { atiende: false, porque: 'motivo_desconocido', motivo, accionBloqueada }
  }

  if (MOTIVOS_RESERVADOS_A_HUMANO.has(motivo)) {
    return { atiende: false, porque: 'motivo_reservado_a_humano', motivo, accionBloqueada }
  }

  return { atiende: true, motivo, accionBloqueada }
}
