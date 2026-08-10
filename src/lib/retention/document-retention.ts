// ============================================================
// Retención de documentos clínicos (conversation_media) — LÓGICA PURA.
//
// ⚠️ CONTEXTO PARA QUIEN LEA ESTO EN EL FUTURO (probablemente dentro de años):
// Este es el ÚNICO cron que destruye datos. NO se puede validar por observación:
// con el Bloque 4 (recepción de archivos) apagado, el dry-run reporta 0
// indefinidamente, y el primer borrado real ocurre 2 años DESPUÉS del primer
// documento recibido. Por eso la red de seguridad son estos tests y el guard de
// volumen — NO la observación en producción. Cada decisión de acá abajo está
// comentada con su POR QUÉ para que se explique sola sin este contexto.
// ============================================================

/**
 * Plazo de retención por defecto, en años. Algia confirmó 2 (2026-07).
 * POR-CLÍNICA: el valor real se lee de `clinics.feature_config.document_retention_years`
 * (distintas clínicas tendrán plazos distintos). Este default aplica solo si la
 * clínica no tiene la clave. Si el config es inválido, se cae a este default —
 * NUNCA se adivina un plazo más corto (borraría de más).
 */
export const RETENTION_DEFAULT_YEARS = 2

/**
 * Guard de volumen: si una corrida quiere borrar MÁS de esto, aborta y alerta
 * en vez de ejecutar.
 *
 * POR QUÉ 100: la retención se mide en años y el cron corre DIARIO → nunca se
 * acumula backlog. Una corrida normal borra a lo sumo los pocos documentos que
 * cumplen el plazo ESE día (realista <10 incluso con cientos de autorizaciones
 * al año). Un número >100 es la firma de un BUG en la condición de fecha —
 * exactamente el orphan-cleanup de iSalud, que por un error de fecha canceló
 * todo. 100 es ~10× cualquier volumen diario real: no da falsos disparos, pero
 * es un muro contra un barrido masivo silencioso. Cualquier purga legítimamente
 * grande (ej. migración) se hace A MANO con supervisión, nunca por este cron.
 */
export const VOLUME_GUARD_MAX = 100

/**
 * Umbral de alerta para la excepción B (pending_review nunca se borra).
 *
 * POR QUÉ ALERTAR: sin esto, "no borrar un proceso abierto" degenera en
 * "retener para siempre porque nadie lo miró". Un archivo que un paciente
 * mandó y espera se revisa en días; el término legal ARCO es ~15 días hábiles.
 * Un archivo sin revisar de más de 30 días está olvidado → se alerta (aunque
 * NO se borra) para que un humano lo resuelva.
 */
export const STALE_PENDING_ALERT_DAYS = 30

export interface RetentionRow {
  createdAt: string       // ISO — momento en que el documento entró a nuestra custodia
  context: string | null  // 'authorization' | 'document_general' | 'other'
  reviewedAt: string | null
}

/**
 * Calcula el cutoff: documentos con created_at ANTERIOR a esta fecha son
 * candidatos a borrado.
 *
 * POR QUÉ created_at COMO ANCLA: es el único anclaje inmutable y siempre
 * presente. reviewed_at puede ser NULL (documento nunca revisado); no hay fecha
 * de cita si el documento no está ligado a una. La obligación de retención
 * empieza cuando tenemos el dato en custodia = created_at. Si el criterio legal
 * de una clínica exigiera medir desde el acto clínico (fecha de atención), este
 * es el punto a cambiar.
 *
 * SANITY: retentionYears debe ser > 0. Un valor <= 0 pondría el cutoff en el
 * futuro y volvería TODO elegible — se lanza en vez de arriesgar un barrido.
 */
export function computeCutoff(retentionYears: number, now: Date): Date {
  if (!Number.isFinite(retentionYears) || retentionYears <= 0) {
    throw new Error(`retentionYears inválido (${retentionYears}) — se aborta para no barrer todo`)
  }
  const cutoff = new Date(now)
  cutoff.setFullYear(cutoff.getFullYear() - retentionYears)
  return cutoff
}

/**
 * Lee el plazo de retención de una clínica desde su feature_config, con
 * fallback DEFENSIVO al default. Un config inválido (string, negativo, 0, NaN)
 * NO se usa — se cae al default seguro. Nunca se toma un plazo más corto por
 * error, porque plazo corto = borra de más.
 */
export function resolveRetentionYears(featureConfig: Record<string, unknown> | null): number {
  const raw = featureConfig?.['document_retention_years']
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw) : NaN)
  if (Number.isInteger(n) && n > 0) return n
  return RETENTION_DEFAULT_YEARS
}

/**
 * ¿La fila es elegible para BORRADO? Solo si es más vieja que el cutoff Y no cae
 * en ninguna excepción.
 *
 * Excepción A (cita futura/activa) — se pasa como flag `hasActiveFutureAppointment`
 * porque requiere lookup en appointments. POR QUÉ: un documento que respalda una
 * cita próxima se necesita operativamente, no se borra aunque cumpla el plazo.
 *
 * Excepción B (proceso abierto) — autorización sin revisar. POR QUÉ: borrarla
 * destruiría un pendiente que nadie resolvió. Se conserva (y se alerta aparte
 * vía isStalePending).
 */
export function isEligibleForDeletion(
  row: RetentionRow,
  cutoff: Date,
  hasActiveFutureAppointment: boolean,
): boolean {
  if (new Date(row.createdAt) >= cutoff) return false                    // más nuevo que el plazo
  if (hasActiveFutureAppointment) return false                           // Exc A
  // Exc B — un archivo SIN REVISAR no se borra, sea cual sea su `context`.
  //
  // Antes esta línea exigía además `context === 'authorization'`, y ese valor lo
  // asigna una heurística que en producción NO SE ASIGNÓ NUNCA: los archivos
  // reales quedan como 'document_general'. O sea que la salvaguarda del único
  // cron que destruye datos estaba desactivada de hecho — protegía 0 de 4
  // archivos sin revisar. Lo único que impidió una pérdida fue el dry-run.
  //
  // El criterio correcto no es "qué tipo de documento parece": es que NADIE LO
  // MIRÓ TODAVÍA. Un proceso abierto no se borra.
  if (row.reviewedAt === null) return false
  return true
}

/**
 * ¿La fila es un pending_review estancado (excepción B que nadie resolvió)?
 * No se borra — se alerta.
 */
export function isStalePending(row: RetentionRow, now: Date, staleDays: number): boolean {
  // Mismo criterio que la excepción B: si aquella protege por "sin revisar",
  // esta tiene que alertar por lo mismo. Con el filtro de context, la alerta que
  // vigila la excepción nunca se disparaba — la salvaguarda no tenía quien la
  // mirara.
  if (row.reviewedAt !== null) return false
  const ageMs = now.getTime() - new Date(row.createdAt).getTime()
  return ageMs > staleDays * 24 * 60 * 60 * 1000
}

/** ¿La cantidad elegible supera el guard de volumen? Si sí, el cron aborta. */
export function exceedsVolumeGuard(eligibleCount: number): boolean {
  return eligibleCount > VOLUME_GUARD_MAX
}
