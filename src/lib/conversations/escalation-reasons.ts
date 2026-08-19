// ============================================================
// POR QUÉ ESCALÓ UNA CONVERSACIÓN — conjunto CERRADO.
//
// Cada camino que escala tiene que estampar uno de estos valores en
// `conversations.context.escalation_reason`. No es documentación: es la clave de
// agrupación del informe de escalaciones. Si cada sitio escribe la prosa que se
// le ocurre, en un mes hay ocho variantes de lo mismo y el informe agrupa mal.
//
// Ya pasó, y de la peor forma: dos escalaciones por autorización quedaron como
// "Autorización pendiente de revisión: Colposcopia con SOS" y "…: Mapeo con
// MEDPLUS". Dos strings distintos para la MISMA causa — con el nombre del
// servicio y del convenio adentro, así que nunca dos iban a coincidir. Agrupar
// por ese campo daba un grupo de tamaño 1 por cada caso.
//
// LA REGLA: el `reason` dice QUÉ MECANISMO disparó, nunca el contenido. El
// contenido (qué keyword, qué servicio, qué convenio) va en `escalation_detail`,
// que es texto libre porque nadie agrupa por él — se lee.
//
//   escalation_reason: 'keyword_configurada'      ← se agrupa
//   escalation_detail: 'médico'                   ← se lee
//
// Agregar un valor nuevo es agregar una línea acá y otra en ESCALATION_MECHANISM.
// El typecheck no te deja olvidarte de la segunda.
// ============================================================

/**
 * Los motivos posibles. El valor es lo que queda escrito en la DB — no se
 * cambia una vez que hay filas con él, porque el histórico deja de agrupar.
 */
export const ESCALATION_REASONS = {
  // — Capa 0: deterministas, corren ANTES del LLM —
  CRISIS: 'crisis',
  DATA_RIGHTS: 'data_rights_request',
  SERVICE_RULE: 'servicio_escalate_human',
  HUMAN_REQUEST: 'pedido_humano',

  // — Keywords configuradas por la clínica —
  KEYWORD: 'keyword_configurada',

  // — El modelo decidió escalar (tool escalate_to_human) —
  AGENT_TOOL: 'escalate_to_human',
  AGENT_REESCALATED: 'reescalado_por_agente',

  // — Fallas técnicas: el agente no pudo, no es que no debiera —
  TOOL_ERROR: 'error_tecnico_tool',
  BOOKING_FAILURE: 'falla_agendamiento',

  // — El agente le PROMETIÓ a la paciente que una persona la iba a contactar y
  //   no llamó escalate_to_human. Motivo propio y no BOOKING_FAILURE: si se
  //   mezclan, en una semana no se pueden contar, y contarlas es el punto. —
  PROMISE_WITHOUT_ESCALATION: 'promesa_sin_escalar',

  // — El agente no encontró la cita y la paciente sostiene que la tiene. NO es
  //   "no tiene cita": es que no la encontramos, y las dos cosas se resuelven
  //   distinto. —
  APPOINTMENT_NOT_FOUND: 'cita_no_encontrada',

  // — No sabemos, y no es lo mismo que "no hay" —
  UNKNOWN_CONVENIO: 'convenio_no_reconocido',

  // — La paciente pidió un médico y el servicio no existe con él. No es falla
  //   técnica: el sistema funcionó y la respuesta honesta es "con él no se
  //   puede". Cambiarla de médico sola es lo que NO se hace. —
  SERVICE_NOT_WITH_DOCTOR: 'servicio_no_existe_con_medico',

  // — La clínica no está operando (contingencia, cierre) —
  CLINIC_NOT_OPERATING: 'clinica_no_operativa',

  // — Documentos que manda la paciente —
  MEDIA_DISABLED: 'media_deshabilitada',
  AUTHORIZATION_REVIEW: 'autorizacion_recibida',
  // Llegó un archivo que NADIE pidió y que no es una autorización. Distinto de
  // MEDIA_DISABLED, que significa lo contrario: ahí el archivo ni se recibió.
  MEDIA_RECEIVED: 'archivo_recibido',

  // — Una persona la sacó del agente desde el dashboard —
  STAFF_TAKEOVER: 'staff_takeover',
  STAFF_ASSIGNED: 'staff_derivada',
  STAFF_MANUAL: 'staff_manual',
} as const

export type EscalationReason = (typeof ESCALATION_REASONS)[keyof typeof ESCALATION_REASONS]

/**
 * QUÉ TIPO DE COSA disparó la escalación. Es la primera pregunta de la rúbrica
 * del informe ("detector de Capa 0, keyword, regla del catálogo o el tool"), y
 * se contesta con una constante en vez de dejársela adivinar a un modelo
 * leyendo la conversación.
 */
export type EscalationMechanism =
  | 'capa_0'          // detector determinista, antes del LLM
  | 'keyword'         // lista de palabras configurada por la clínica
  | 'tool_agente'     // el modelo llamó escalate_to_human
  | 'falla_tecnica'   // el agente quiso y no pudo
  | 'falta_de_dato'   // el sistema no sabe, y no puede afirmar que no exista
  | 'operacion'       // la clínica no está atendiendo (contingencia, cierre)
  | 'documento'       // llegó un archivo
  | 'humano'          // una persona del staff, desde el dashboard

export const ESCALATION_MECHANISM: Record<EscalationReason, EscalationMechanism> = {
  [ESCALATION_REASONS.CRISIS]: 'capa_0',
  [ESCALATION_REASONS.DATA_RIGHTS]: 'capa_0',
  [ESCALATION_REASONS.SERVICE_RULE]: 'capa_0',
  [ESCALATION_REASONS.HUMAN_REQUEST]: 'capa_0',
  [ESCALATION_REASONS.KEYWORD]: 'keyword',
  [ESCALATION_REASONS.AGENT_TOOL]: 'tool_agente',
  [ESCALATION_REASONS.AGENT_REESCALATED]: 'tool_agente',
  [ESCALATION_REASONS.TOOL_ERROR]: 'falla_tecnica',
  [ESCALATION_REASONS.BOOKING_FAILURE]: 'falla_tecnica',
  [ESCALATION_REASONS.PROMISE_WITHOUT_ESCALATION]: 'falla_tecnica',
  [ESCALATION_REASONS.APPOINTMENT_NOT_FOUND]: 'falla_tecnica',
  [ESCALATION_REASONS.UNKNOWN_CONVENIO]: 'falta_de_dato',
  [ESCALATION_REASONS.SERVICE_NOT_WITH_DOCTOR]: 'falta_de_dato',
  [ESCALATION_REASONS.CLINIC_NOT_OPERATING]: 'operacion',
  [ESCALATION_REASONS.MEDIA_DISABLED]: 'documento',
  [ESCALATION_REASONS.MEDIA_RECEIVED]: 'documento',
  [ESCALATION_REASONS.AUTHORIZATION_REVIEW]: 'documento',
  [ESCALATION_REASONS.STAFF_TAKEOVER]: 'humano',
  [ESCALATION_REASONS.STAFF_ASSIGNED]: 'humano',
  [ESCALATION_REASONS.STAFF_MANUAL]: 'humano',
}

/** Etiqueta en español para el informe. */
export const ESCALATION_LABEL: Record<EscalationReason, string> = {
  [ESCALATION_REASONS.CRISIS]: 'Crisis detectada',
  [ESCALATION_REASONS.DATA_RIGHTS]: 'Derecho ARCO sobre datos',
  [ESCALATION_REASONS.SERVICE_RULE]: 'Servicio con regla de validación humana',
  [ESCALATION_REASONS.HUMAN_REQUEST]: 'Pidió hablar con una persona',
  [ESCALATION_REASONS.KEYWORD]: 'Keyword configurada por la clínica',
  [ESCALATION_REASONS.AGENT_TOOL]: 'El agente decidió escalar',
  [ESCALATION_REASONS.AGENT_REESCALATED]: 'El agente volvió a escalar tras devolución',
  [ESCALATION_REASONS.TOOL_ERROR]: 'Error técnico de una tool',
  [ESCALATION_REASONS.BOOKING_FAILURE]: 'Falla al agendar',
  [ESCALATION_REASONS.PROMISE_WITHOUT_ESCALATION]: 'Prometió una persona y no escaló',
  [ESCALATION_REASONS.APPOINTMENT_NOT_FOUND]: 'No encontró la cita que ella dice tener',
  [ESCALATION_REASONS.UNKNOWN_CONVENIO]: 'Convenio que no tenemos registrado',
  [ESCALATION_REASONS.SERVICE_NOT_WITH_DOCTOR]: 'El servicio no existe con el médico que pidió',
  [ESCALATION_REASONS.CLINIC_NOT_OPERATING]: 'La clínica no está operando',
  [ESCALATION_REASONS.MEDIA_DISABLED]: 'Archivo recibido con recepción deshabilitada',
  [ESCALATION_REASONS.AUTHORIZATION_REVIEW]: 'Autorización recibida, pendiente de revisión',
  [ESCALATION_REASONS.MEDIA_RECEIVED]: 'Archivo recibido sin que nadie lo pidiera',
  [ESCALATION_REASONS.STAFF_TAKEOVER]: 'Alguien del staff la atendió',
  [ESCALATION_REASONS.STAFF_ASSIGNED]: 'Derivada a un médico',
  [ESCALATION_REASONS.STAFF_MANUAL]: 'Movida a Atención a mano',
}

const VALID = new Set<string>(Object.values(ESCALATION_REASONS))

/**
 * ¿Este valor es del conjunto cerrado? Lo usa el informe para separar lo que
 * SABE de lo que INFIERE: si el motivo guardado no está acá, es de antes de que
 * existiera este archivo y hay que deducirlo leyendo la conversación.
 */
export function isKnownReason(v: unknown): v is EscalationReason {
  return typeof v === 'string' && VALID.has(v)
}

/**
 * Arma el `context` de una escalación PRESERVANDO lo que ya había.
 *
 * Existe porque casi todos los call sites hacían `context: { escalation_reason }`
 * a secas — reemplazo total del objeto. Una conversación con `servicios_marcados`
 * que después entraba en crisis perdía el pendiente, y con él su lugar en la cola
 * de Atención. El pendiente desaparecía sin que nadie tocara nada.
 */
export function escalationContext(
  prev: Record<string, unknown> | null | undefined,
  reason: EscalationReason,
  detail?: string | null,
): Record<string, unknown> {
  return {
    ...(prev ?? {}),
    escalation_reason: reason,
    ...(detail ? { escalation_detail: detail } : {}),
  }
}

/**
 * Motivo para una escalación que inicia una PERSONA desde el dashboard.
 *
 * Con una regla que no es obvia: si la conversación YA estaba escalada, el
 * motivo original manda. Quien la toma no es la causa — es la consecuencia.
 * Una conversación que escaló por crisis y que después alguien atiende sigue
 * siendo una escalación por crisis; pisarla con 'staff_takeover' borraría
 * justamente el dato por el que existe el informe.
 *
 * Solo cuando la conversación venía `active` —o sea, la persona la sacó del
 * agente por decisión propia— el motivo humano es el verdadero.
 */
export function staffEscalationContext(
  prev: Record<string, unknown> | null | undefined,
  reason: EscalationReason,
  veniaDelAgente: boolean,
): Record<string, unknown> {
  const p = prev ?? {}
  if (!veniaDelAgente && p.escalation_reason) return p
  return escalationContext(p, reason)
}

/**
 * Guarda el motivo que se está BORRANDO al devolver la conversación al agente.
 *
 * "Que siga el agente" limpia el context, y con él el motivo — así que las
 * escalaciones que el staff resolvió bien y devolvió (justo las que contestan
 * "¿hacía falta un humano?") se borraban solas. Esto deja el rastro mínimo:
 * qué fue y cuándo, sin nada del contenido de la conversación.
 */
export function historyOnReturn(
  prev: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const p = prev ?? {}
  const reason = p.escalation_reason
  if (!reason) return {}

  const previa = Array.isArray(p.escalation_history) ? (p.escalation_history as unknown[]) : []
  return {
    escalation_history: [
      ...previa,
      {
        reason,
        detail: (p.escalation_detail as string | undefined) ?? null,
        devuelta_at: new Date().toISOString(),
      },
    ].slice(-20),   // techo: no dejamos crecer el JSONB sin límite
  }
}
