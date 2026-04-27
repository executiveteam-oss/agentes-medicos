// ============================================================
// Utilidades de fechas, dinero y teléfonos para Colombia
// REGLA: siempre guardar UTC en DB, mostrar en COT al paciente
// Zona horaria: America/Bogota (UTC-5 todo el año, no hay horario de verano)
// ============================================================

import { format, addMinutes, parseISO, isValid } from 'date-fns'
import { es } from 'date-fns/locale'
import { toZonedTime } from 'date-fns-tz'

const TIMEZONE = 'America/Bogota'

/**
 * Obtiene la fecha y hora actual en Colombia
 * Ejemplo: si en UTC son las 20:00, en Colombia son las 3:00 PM
 */
export function nowColombia(): Date {
  return toZonedTime(new Date(), TIMEZONE)
}

/**
 * Convierte una fecha UTC a hora colombiana para mostrar al paciente
 * Formato: "martes 15 de febrero de 2026, 2:00 PM"
 *
 * @param utcDate - Fecha en formato ISO 8601 (como viene de la DB)
 */
export function formatForPatient(utcDate: string): string {
  const date = parseISO(utcDate)
  if (!isValid(date)) return 'Fecha no válida'

  const colombiaDate = toZonedTime(date, TIMEZONE)

  // Formato: "martes 15 de febrero" — natural en español
  return format(colombiaDate, "EEEE d 'de' MMMM, h:mm a", { locale: es })
}

/**
 * Convierte una fecha ISO a solo la hora para el paciente
 * Formato: "2:00 PM"
 */
export function formatTimeForPatient(utcDate: string): string {
  const date = parseISO(utcDate)
  if (!isValid(date)) return 'Hora no válida'

  const colombiaDate = toZonedTime(date, TIMEZONE)
  return format(colombiaDate, 'h:mm a', { locale: es })
}

/**
 * Convierte una fecha ISO a solo la fecha para el paciente
 * Formato: "martes 15 de febrero"
 */
export function formatDateForPatient(utcDate: string): string {
  const date = parseISO(utcDate)
  if (!isValid(date)) return 'Fecha no válida'

  const colombiaDate = toZonedTime(date, TIMEZONE)
  return format(colombiaDate, "EEEE d 'de' MMMM", { locale: es })
}

/**
 * Calcula la hora de fin de una cita sumando la duración
 * @param startsAt - Hora de inicio en ISO 8601
 * @param durationMinutes - Duración en minutos (default 30)
 * @returns Hora de fin en ISO 8601
 */
export function calculateEndTime(startsAt: string, durationMinutes: number = 30): string {
  const start = parseISO(startsAt)
  if (!isValid(start)) throw new Error('Fecha de inicio no válida')

  return addMinutes(start, durationMinutes).toISOString()
}

/**
 * Formatea dinero en pesos colombianos
 * Ejemplo: 80000 → "$80.000 COP"
 *
 * Convención Colombia: punto como separador de miles, sin decimales
 */
export function formatCOP(amount: number): string {
  const formatted = new Intl.NumberFormat('es-CO', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)

  return `$${formatted} COP`
}

/**
 * Formatea un teléfono para mostrar al paciente
 * Ejemplo: "+573101112233" → "310 111 2233"
 *
 * Convención: no mostrar +57, separar por espacios
 */
export function formatPhone(phone: string): string {
  // Quitar el +57 si lo tiene
  const cleaned = phone.replace(/^\+57/, '')

  // Formato: XXX XXX XXXX
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`
  }

  // Si no tiene 10 dígitos, devolver tal cual
  return cleaned
}

/**
 * Normaliza un teléfono al formato de almacenamiento: +57XXXXXXXXXX
 * Acepta: "3101112233", "573101112233", "+573101112233", "310 111 2233"
 */
export function normalizePhone(phone: string): string {
  // Quitar todo excepto dígitos
  const digits = phone.replace(/\D/g, '')

  // Si tiene 10 dígitos (cel colombiano sin código), agregar +57
  if (digits.length === 10 && digits.startsWith('3')) {
    return `+57${digits}`
  }

  // Si tiene 12 dígitos y empieza con 57 (con código pero sin +)
  if (digits.length === 12 && digits.startsWith('57')) {
    return `+${digits}`
  }

  // Si ya tiene el formato correcto
  if (phone.startsWith('+57') && digits.length === 12) {
    return `+${digits}`
  }

  // Devolver con + por defecto
  return `+${digits}`
}

/**
 * Obtiene el nombre del día en inglés para los horarios (working_hours keys).
 * SIEMPRE convierte a timezone Colombia antes de calcular el día.
 * Esto evita bugs cuando date está en UTC midnight (puede ser día anterior en COT).
 */
export function getDayOfWeek(date: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const zoned = toZonedTime(date, TIMEZONE)
  return days[zoned.getDay()]
}
