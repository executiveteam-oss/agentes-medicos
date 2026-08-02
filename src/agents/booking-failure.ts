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
