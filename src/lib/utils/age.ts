// Cálculo de edad a partir de fecha de nacimiento.
// Considera mes + día (no solo año): alguien que cumple en diciembre
// y hoy es junio aún tiene la edad del año anterior.

import { differenceInYears, isValid, parseISO } from 'date-fns'

/**
 * Calcula la edad ACTUAL en años a partir de una fecha de nacimiento.
 * Considera mes y día — no solo el año.
 *
 * @param birthDateISO Fecha en formato ISO (YYYY-MM-DD) o null/undefined
 * @param now          Referencia "hoy" (default: new Date()). Útil para tests.
 * @returns Edad en años, o null si la fecha es inválida/nula
 */
export function calculateAgeFromBirthDate(
  birthDateISO: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!birthDateISO) return null

  const birth = parseISO(birthDateISO)
  if (!isValid(birth)) return null

  // Fechas futuras o anteriores a 1900 son sospechosas — devolvemos null
  // para que la capa B fuerce derivación a humano.
  const year = birth.getFullYear()
  if (year < 1900 || birth > now) return null

  const age = differenceInYears(now, birth)

  // Sanity: edad > 120 implica fecha mal ingresada (typo en año)
  if (age > 120 || age < 0) return null

  return age
}
