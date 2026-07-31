// ============================================================
// ⏳ MIGRACIÓN ALGIA — código de un solo uso (ver CLAUDE.md).
//
// Derivación PURA (re-ejecutable sobre isalud_historico_rows, sin re-scrapear):
//   - entidad  = aseguradora de la fila MÁS RECIENTE (no la más frecuente)
//   - tratante = profesional de la fila-CONSULTA más reciente
//               (un procedimiento NO define tratante)
// La clasificación consulta/procedimiento es una regla ajustable contra el
// catálogo de servicios, con fallback por keywords.
// ============================================================

export interface DerivRow {
  aseguradora: string | null
  profesional: string | null
  servicio: string | null
  procedimiento: string | null
  fecha: string | null      // YYYY-MM-DD
  inicio: string | null     // HH:MM:SS
  isalud_agenda_id: number
}

/** Clave de orden para "más reciente": fecha, luego inicio, luego id (desempate estable). */
function recencyKey(r: DerivRow): string {
  return `${r.fecha ?? '0000-00-00'} ${r.inicio ?? '00:00:00'} ${String(r.isalud_agenda_id).padStart(12, '0')}`
}

/** Ordena filas de más reciente a más antigua. */
function sortRecentFirst(rows: DerivRow[]): DerivRow[] {
  return [...rows].sort((a, b) => (recencyKey(a) < recencyKey(b) ? 1 : recencyKey(a) > recencyKey(b) ? -1 : 0))
}

/**
 * Clasifica un servicio como 'consulta' o 'procedimiento'.
 * - Si `catalogConsultaServices` (nombres de servicios que el catálogo marca
 *   como consulta) contiene el servicio → usa eso (fuente de verdad ajustable).
 * - Fallback por keyword sobre el texto de servicio.
 */
export function classifyServicio(
  servicio: string | null,
  _procedimiento: string | null,
  catalogConsultaServices?: Set<string>,
): 'consulta' | 'procedimiento' {
  const norm = (servicio ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  if (!norm) return 'procedimiento'
  if (catalogConsultaServices && catalogConsultaServices.has(norm)) return 'consulta'
  // Fallback keyword: consultas/controles/valoraciones definen tratante.
  if (/^(CONSULTA|CONTROL|VALORACION|PRIMERA VEZ|CONTROL ENTREGA|ENTREGA RESULTADOS|ASESORIA)/.test(norm)) return 'consulta'
  return 'procedimiento'
}

/** Aseguradora de la fila más reciente. null si no hay ninguna con aseguradora. */
export function deriveEntidad(rows: DerivRow[]): string | null {
  for (const r of sortRecentFirst(rows)) {
    if (r.aseguradora) return r.aseguradora
  }
  return null
}

/**
 * Doctor-id del tratante: la CONSULTA más reciente cuyo profesional resuelve a
 * un médico ACTIVO (resolveDoctorId devuelve el id, o null si no es médico
 * activo). DOS condiciones: (1) el servicio es consulta Y (2) el profesional
 * matchea un médico activo de doctors. Así el staff administrativo / los
 * médicos inactivos que aparecen en la columna profesional NO definen tratante,
 * sin enumerar a nadie. Devuelve el doctor-id o null.
 */
export function deriveTratante(
  rows: DerivRow[],
  resolveDoctorId: (profesional: string) => string | null,
  catalogConsultaServices?: Set<string>,
): string | null {
  for (const r of sortRecentFirst(rows)) {
    if (classifyServicio(r.servicio, r.procedimiento, catalogConsultaServices) !== 'consulta') continue
    if (!r.profesional) continue
    const id = resolveDoctorId(r.profesional)
    if (id) return id
  }
  return null
}
