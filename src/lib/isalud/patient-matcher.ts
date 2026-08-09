// ============================================================
// ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
//
// Match anti-duplicados entre un cliente iSalud (ya filtrado por
// name-matcher) y los pacientes existentes en Omuwan.
//
// Orden de match:
//   1. Por document_number (cédula) → existe → UPDATE
//   2. Por phone normalizado (+57XXXXXXXXXX) → existe → UPDATE + agregar cédula
//   3. Nada coincide → INSERT
//
// Lógica pura, sin DB.
// ============================================================

import { normalizePhone } from '@/lib/utils/dates'

export type PatientMatchType =
  | 'match_by_cedula'    // existe en Omuwan con misma cédula → UPDATE (probable add phone)
  | 'match_by_phone'     // existe en Omuwan con mismo phone, distinta o sin cédula → UPDATE add_cedula
  | 'insert'             // no existe → crear paciente nuevo
  | 'skip_phone_invalid' // phone no normaliza a +57XXXXXXXXXX
  | 'skip_cedula_invalid'// cédula vacía o < 5 dígitos
  | 'skip_name_empty'    // nombre vacío

export interface PatientMatchResult {
  type: PatientMatchType
  existing_patient_id?: string
  normalized_phone: string  // siempre disponible (vacío si skip por phone)
  reason?: string           // detalle del skip si aplica
}

export interface ExistingPatientLite {
  id: string
  document_number: string | null
  phone: string             // ya en formato +57XXXXXXXXXX
  name: string
}

export interface IncomingCliente {
  documento: string         // cédula limpia (solo dígitos)
  nombre: string            // canonizado o raw — no afecta este matcher
  telefono: string          // raw, sin normalizar
}

/**
 * Valida que un phone normalizado tenga formato colombiano correcto.
 *   +57 + 10 dígitos empezando con 3 (celular)
 */
function isValidColombianMobile(normalized: string): boolean {
  return /^\+573\d{9}$/.test(normalized)
}

/**
 * Match principal. Devuelve qué hacer con este cliente:
 * INSERT, UPDATE por cédula, UPDATE por phone, o SKIP.
 *
 * @param cliente  fila scrapeada de iSalud
 * @param existing pacientes actuales de Omuwan (todos los de la clínica)
 */
export function matchClienteToPatient(
  cliente: IncomingCliente,
  existing: ExistingPatientLite[],
): PatientMatchResult {
  // Validación previa
  if (!cliente.nombre.trim()) {
    return { type: 'skip_name_empty', normalized_phone: '', reason: 'nombre vacío' }
  }
  if (!cliente.documento || cliente.documento.length < 5) {
    return {
      type: 'skip_cedula_invalid',
      normalized_phone: '',
      reason: `cédula inválida: "${cliente.documento}"`,
    }
  }

  const normalized = normalizePhone(cliente.telefono)
  if (!isValidColombianMobile(normalized)) {
    return {
      type: 'skip_phone_invalid',
      normalized_phone: normalized,
      reason: `phone no es móvil colombiano válido: "${cliente.telefono}" → "${normalized}"`,
    }
  }

  // 1. Match por cédula (preferido)
  const cedulaMatch = existing.find((p) => p.document_number === cliente.documento)
  if (cedulaMatch) {
    return {
      type: 'match_by_cedula',
      existing_patient_id: cedulaMatch.id,
      normalized_phone: normalized,
    }
  }

  // 2. Match por phone (fallback)
  const phoneMatch = existing.find((p) => p.phone === normalized)
  if (phoneMatch) {
    return {
      type: 'match_by_phone',
      existing_patient_id: phoneMatch.id,
      normalized_phone: normalized,
    }
  }

  // 3. INSERT
  return { type: 'insert', normalized_phone: normalized }
}
