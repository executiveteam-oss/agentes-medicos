// ============================================================
// UNA sola respuesta a "¿este horario está libre?", compartida por
// check_availability (genera slots) y create_appointment (valida el insert).
// Dos implementaciones separadas de esta pregunta fue lo que rompió el
// agendamiento (check_availability comparaba starts_at por STRING —
// "…+00:00" vs "…000Z" nunca matcheaban → nunca restaba ninguna cita).
// Acá se compara por INSTANTE (Date.parse), con solapamiento real.
// ============================================================

/** Estados que ocupan la agenda. Único lugar donde se definen — ambas queries
 *  deben filtrar por esto para no volver a divergir.
 *
 *  🔴 'rescheduled' NO está, y es a propósito (2026-08-20).
 *
 *  Reagendar marca la cita vieja como 'rescheduled' e INSERTA una nueva
 *  (executor.ts, rescheduleAppointment): esa fila es el original MUERTO, no una
 *  cita viva. Mientras estuvo en esta lista, mover una cita del 28 al 30 dejaba
 *  el cupo del 28 ocupado para siempre — nadie lo podía usar y nadie sabía por
 *  qué. Es el único estado de la tabla que significa "esto ya no existe" y aun
 *  así reservaba agenda.
 *
 *  Ojo: el índice único parcial idx_appointments_no_double_booking cubría
 *  ('confirmed','rescheduled'), así que sacarlo de acá sin tocar el índice
 *  habría sido peor — el agente ofrecía el cupo liberado y el INSERT fallaba
 *  con violación de unicidad. La migración 00110 lo dejó sólo en 'confirmed'.
 *  Si alguien vuelve a tocar esta lista, tiene que mirar ese índice. */
export const BUSY_STATUSES = ['confirmed', 'blocked_external'] as const

export function isBusyStatus(status: string | null | undefined): boolean {
  return status != null && (BUSY_STATUSES as readonly string[]).includes(status)
}

export interface BusyAppointment {
  starts_at: string
  ends_at: string
  status?: string | null   // si viene, se ignoran los no-ocupados; si no, se asume pre-filtrado
}

/** ¿El intervalo [startIso, endIso) se solapa con alguna cita ocupada?
 *  Fin EXCLUSIVO: una cita que termina justo cuando el slot empieza NO solapa.
 *  Compara instantes (tolera +00:00 vs .000Z). Fecha inválida → true (defensivo:
 *  ante la duda, NO ofrecer / NO agendar). */
export function slotOverlapsAny(startIso: string, endIso: string, appts: BusyAppointment[]): boolean {
  const s = Date.parse(startIso)
  const e = Date.parse(endIso)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return true
  return appts.some((a) => {
    if (a.status !== undefined && !isBusyStatus(a.status)) return false
    const as = Date.parse(a.starts_at)
    const ae = Date.parse(a.ends_at)
    if (!Number.isFinite(as) || !Number.isFinite(ae)) return false
    return as < e && ae > s
  })
}

/** ¿El intervalo [startIso, endIso) está libre? */
export function isSlotFree(startIso: string, endIso: string, appts: BusyAppointment[]): boolean {
  return !slotOverlapsAny(startIso, endIso, appts)
}
