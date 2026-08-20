// ============================================================
// BUG #4 — ¿el rechazo del executor es una falla DURA de agendamiento?
// (create/reschedule rechazado por slot ocupado o fuera de horario/pasado)
// vs una regla de negocio legítima (edad, condición, convenio, escalate-service)
// que el LLM debe explicarle al paciente. Solo las duras escalan a una persona.
// Determinista, testeable, no criterio del modelo.
// ============================================================

const BOOKING_TOOLS = new Set(['create_appointment', 'reschedule_appointment'])

/** true SOLO para SLOT_JUST_TAKEN (doble-booking al insertar) y BLOCKED_BY_SCHEDULE
 *  (pasado/agenda cerrada/fuera de franja) en create/reschedule. Las reglas de
 *  negocio (edad, condicion, convenio, escalate-service, auth pendiente) NO son
 *  fallas duras: el flujo ya les da el mensaje correcto al paciente.
 *
 *  ⚠️ BLOCKED_BY_DATE (día que la clínica bloqueó) NO ENTRA ACÁ, y la distinción
 *  es fina: los otros tres casos de BLOCKED_BY_SCHEDULE son el modelo pidiendo
 *  algo que no debía —una fecha pasada, un médico de vacaciones, un horario
 *  fuera de la franja—, y eso amerita que una persona mire. Que la clínica
 *  cierre un viernes es información de negocio corriente: el agente dice "ese
 *  día no hay atención" y ofrece otra fecha. Escalarlo le trasladaba a una
 *  secretaria algo que el agente resuelve solo, y a la paciente le decía
 *  "tuve un inconveniente técnico" sobre una decisión deliberada de la clínica.
 *
 *  ⚠️ BLOCKED_OUT_OF_SCHEDULE tampoco entra, por la misma razón. Salió de
 *  BLOCKED_BY_SCHEDULE el 2026-08-20: pedir una hora fuera de la franja del
 *  médico lo resuelve el agente llamando check_availability con ESE médico y
 *  ofreciendo horas válidas. Que escale deja a la paciente con "hubo un
 *  problema" en vez de un horario. El intento igual queda en audit_log con
 *  llm_attempted_anyway: true — ahí se detecta si el modelo empieza a pedir
 *  horas imposibles. Los que SIGUEN escalando bajo BLOCKED_BY_SCHEDULE son
 *  fecha pasada y agenda cerrada. */
export function isHardBookingFailure(toolName: string, errorCode: string | null | undefined): boolean {
  if (!BOOKING_TOOLS.has(toolName)) return false
  const code = String(errorCode ?? '')
  // 🔴 SLOT_JUST_TAKEN SALIÓ DE ACÁ (2026-08-20).
  //
  // Escalaba, así que la paciente oía "Uy, tuve un inconveniente para agendar"
  // y una secretaria recibía la alerta — por un cupo ocupado, que es la cosa
  // más normal de una agenda. Medidos 4 casos del 15 al 19/08: NINGUNA de las
  // cuatro terminó con cita, y una (Nataly) probó CINCO días a ciegas antes de
  // rendirse porque el agente nunca le dijo cuáles estaban libres.
  //
  // Ahora el bloqueo trae los cupos reales del médico y el agente los ofrece.
  // El intento queda igual en audit_log. Sigue siendo falla dura sólo lo que
  // amerita que una persona mire: fecha pasada y agenda cerrada.
  return code === 'BLOCKED_BY_SCHEDULE'
}

/**
 * ¿El error de una tool (CUALQUIERA) es un fallo TÉCNICO del sistema (excepción
 * atrapada, error de DB), no un resultado de negocio? Los técnicos se marcan con
 * el prefijo 'INTERNAL_ERROR' en el executor. Un fallo técnico NO se le narra al
 * paciente por el LLM (que lo disfrazaría de "clínica llena" / lista de espera):
 * se corta determinista, se avisa que hubo un problema y se escala. Los
 * resultados de negocio (available:false, agenda_closed, fecha inválida, sin
 * convenio) NO llevan este prefijo y siguen yendo al LLM.
 */
export function isTechnicalError(errorCode: string | null | undefined): boolean {
  return String(errorCode ?? '').startsWith('INTERNAL_ERROR')
}

/**
 * ¿La tool de convenios no reconoció lo que dijo la paciente?
 *
 * No es un fallo técnico ni un resultado de negocio: es AUSENCIA DE
 * CONOCIMIENTO. El catálogo de Algia cubre 4.008 de 10.734 pacientes con
 * entidad registrada, así que "no lo encuentro" es lo más común, y tratarlo
 * como "no hay convenio" manda a la mayoría a pagar particular teniendo
 * cobertura.
 *
 * Va por el corte determinista —no por el LLM— por la misma razón que los
 * técnicos: el modelo narra con fidelidad lo que le dicta la tool, así que si
 * la tool dice "no hay", él dice "no hay". La garantía tiene que estar en la
 * estructura.
 */
export function isUnknownConvenio(errorCode: string | null | undefined): boolean {
  return String(errorCode ?? '').startsWith('CONVENIO_NO_RECONOCIDO')
}

/**
 * ¿La clínica no está operando (contingencia, cerrado)?
 *
 * Va por el corte determinista y NO por el LLM, por la misma razón que el
 * convenio no reconocido: el modelo narra lo que le dicta la tool, y acá lo que
 * está en juego es que le afirme a una paciente "sí, estamos abiertos" un día
 * que la clínica no abrió. Eso la hace viajar.
 */
export function isClinicaNoOperativa(errorCode: string | null | undefined): boolean {
  return String(errorCode ?? '').startsWith('CLINICA_NO_OPERATIVA')
}
