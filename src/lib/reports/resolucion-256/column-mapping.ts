// ============================================================
// Mapeo puro: Res256SourceRow → Res256Row (12 columnas PISIS).
// Sin DB, sin red. Testable con fixtures.
// ============================================================

import { formatInTimeZone } from 'date-fns-tz'
import type { Res256Row, Res256SourceRow } from './types'
import { findEapbCodeByName, EAPB_CODE_PARTICULAR } from '@/lib/utils/eapb-codes'

const COT = 'America/Bogota'

/** Doc type del schema → código PISIS */
export function normalizeDocumentTypeForPisis(t: string | null): string {
  if (!t) return ''
  const map: Record<string, string> = {
    CC: 'CC',
    TI: 'TI',
    CE: 'CE',
    PP: 'PA',     // nuestro 'PP' (Pasaporte) → PISIS 'PA'
    PA: 'PA',
    RC: 'RC',
    MS: 'MS',
    AS: 'AS',
  }
  return map[t] ?? ''
}

/** Strip ceros a la izquierda, mantener números válidos */
function stripLeadingZeros(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/^0+/, '') || ''
}

/** ISO timestamp → YYYY-MM-DD en Bogotá */
function toYYYYMMDDInCot(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return formatInTimeZone(new Date(iso), COT, 'yyyy-MM-dd')
  } catch {
    return ''
  }
}

/**
 * Resuelve el código EAPB de un row.
 * Orden de precedencia:
 * 1. patient.eapb_code (lo más confiable, capturado en form)
 * 2. patient.eps text → lookup
 * 3. appointment.eps_name text → lookup
 * 4. Si payment_type=Particular → 'NA'
 * 5. '' si nada matchea
 */
function resolveEapbCode(source: Res256SourceRow): string {
  const p = source.patient
  const a = source.appointment

  if (p?.eapb_code) return p.eapb_code
  if (p?.eps) {
    const c = findEapbCodeByName(p.eps)
    if (c) return c
  }
  if (a.eps_name) {
    const c = findEapbCodeByName(a.eps_name)
    if (c) return c
  }
  if (a.payment_type === 'Particular') return EAPB_CODE_PARTICULAR
  return ''
}

/**
 * Mapper principal. Returns Res256Row con campos formateados según PISIS.
 * Si un campo no se puede determinar, queda string vacío — la validación
 * downstream decide si va a "Listas" o "Incompletas".
 */
export function mapSourceRowToRes256Row(source: Res256SourceRow): Res256Row {
  const p = source.patient
  const a = source.appointment

  return {
    identificacion: normalizeDocumentTypeForPisis(p?.document_type ?? null),
    numero: stripLeadingZeros(p?.document_number),
    fecha_nacimiento: p?.date_of_birth ?? '',
    genero: p?.gender ?? '',
    primer_nombre: p?.first_name ?? '',
    segundo_nombre: p?.middle_name ?? '',
    primer_apellido: p?.first_last_name ?? '',
    segundo_apellido: p?.second_last_name ?? '',
    codigo_eapb: resolveEapbCode(source),
    fecha_solicitud_cita: toYYYYMMDDInCot(a.requested_at ?? a.created_at),
    fecha_asignacion: toYYYYMMDDInCot(a.starts_at),
    fecha_deseada: a.desired_at ?? toYYYYMMDDInCot(a.starts_at),
  }
}

/** Orden de las 12 columnas PISIS (header del xlsx) */
export const PISIS_COLUMNS_ORDER: readonly (keyof Res256Row)[] = [
  'identificacion',
  'numero',
  'fecha_nacimiento',
  'genero',
  'primer_nombre',
  'segundo_nombre',
  'primer_apellido',
  'segundo_apellido',
  'codigo_eapb',
  'fecha_solicitud_cita',
  'fecha_asignacion',
  'fecha_deseada',
] as const

/** Headers exactos que MinSalud espera */
export const PISIS_COLUMN_HEADERS: readonly string[] = [
  'IDENTIFICACION',
  'NUMERO',
  'FECHA NACIMIENTO',
  'GENERO',
  'PRIMER NOMBRE',
  'SEGUNDO NOMBRE',
  'PRIMER APELLIDO',
  'SEGUNDO APELLIDO',
  'CODIGO EAPB',
  'FECHA SOLICITUD CITA',
  'FECHA ASIGNACION',
  'FECHA DESEADA',
] as const
