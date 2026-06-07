// Validación pre-export según PISIS:
// - 10 campos obligatorios (segundo_nombre y segundo_apellido pueden estar vacíos)
// - Solo verifica no-vacío. Validaciones de formato (e.g. fecha_nacimiento es YYYY-MM-DD)
//   se garantizan upstream en column-mapping.
import type { Res256Row } from './types'

export const REQUIRED_FIELDS: readonly (keyof Res256Row)[] = [
  'identificacion',
  'numero',
  'fecha_nacimiento',
  'genero',
  'primer_nombre',
  'primer_apellido',
  'codigo_eapb',
  'fecha_solicitud_cita',
  'fecha_asignacion',
  'fecha_deseada',
] as const

export interface ValidationResult {
  valid: boolean
  missingFields: (keyof Res256Row)[]
}

export function validateRes256Row(row: Res256Row): ValidationResult {
  const missing: (keyof Res256Row)[] = []
  for (const f of REQUIRED_FIELDS) {
    if (!row[f] || row[f].trim() === '') missing.push(f)
  }
  return { valid: missing.length === 0, missingFields: missing }
}
