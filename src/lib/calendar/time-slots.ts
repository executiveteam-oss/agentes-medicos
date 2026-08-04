// ============================================================
// Generación de cupos de agenda sobre una grilla fija.
//
// Los cupos SIEMPRE caen en :00/:15/:30/:45, sin importar la duración del
// servicio. Antes se avanzaba de a `duration` desde el inicio del día, así que
// una duración que no divide la hora (ej. 19 min) arrastraba la grilla a
// horarios feos (3:17, 3:55...) que ninguna clínica agenda.
//
// Módulo puro (sin DB) → testeable sin red.
// ============================================================

import { parseISO, addMinutes } from 'date-fns'
import { formatTimeForPatient } from '@/lib/utils/dates'

export const SLOT_GRID_MINUTES = 15

/** Redondea hacia arriba al próximo múltiplo de 15 min. El offset COT es -05:00
 *  (hora entera), así que redondear los ms UTC alinea también la hora local a
 *  :00/:15/:30/:45. */
export function ceilToGrid(d: Date): Date {
  const q = SLOT_GRID_MINUTES * 60000
  return new Date(Math.ceil(d.getTime() / q) * q)
}

/**
 * Genera los cupos de un bloque sobre la grilla de 15 min.
 * El cupo se ofrece si la consulta completa (durationMinutes) cabe antes del
 * cierre del bloque. Ejemplo: 8:00–18:00, servicio de 20 min → 8:00, 8:15,
 * 8:30, ... (cada 15). La duración solo decide si el cupo cabe, no el paso.
 */
export function generateTimeSlots(
  dateStr: string,
  startTime: string,
  endTime: string,
  durationMinutes: number,
): Array<{ utc: string; display: string }> {
  const slots: Array<{ utc: string; display: string }> = []

  const blockStart = parseISO(`${dateStr}T${startTime}:00-05:00`)
  const endDate = parseISO(`${dateStr}T${endTime}:00-05:00`)

  // Primer cupo: inicio del bloque alineado a la grilla (:00/:15/:30/:45).
  let current = ceilToGrid(blockStart)
  while (current < endDate) {
    const slotEnd = addMinutes(current, durationMinutes)
    // Solo agregar si la consulta completa cabe antes del cierre.
    if (slotEnd <= endDate) {
      slots.push({
        utc: current.toISOString(),
        display: formatTimeForPatient(current.toISOString()),
      })
    }
    current = addMinutes(current, SLOT_GRID_MINUTES)
  }

  return slots
}
