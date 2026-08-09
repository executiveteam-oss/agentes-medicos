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
 *  fallas duras: el flujo ya les da el mensaje correcto al paciente. */
export function isHardBookingFailure(toolName: string, errorCode: string | null | undefined): boolean {
  if (!BOOKING_TOOLS.has(toolName)) return false
  const code = String(errorCode ?? '')
  return code.startsWith('SLOT_JUST_TAKEN') || code === 'BLOCKED_BY_SCHEDULE'
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
