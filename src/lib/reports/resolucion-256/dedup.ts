// ============================================================
// Lógica de dedup primera-del-año por paciente+categoría.
// - Ginecología y Obstetricia: solo primera cita del año
// - Ecografía y Resonancia Magnética: TODAS las citas
// - NoAplica/null: excluidas (no llegan acá, filtran antes)
// ============================================================

import type { Res256SourceRow } from './types'

const DEDUP_CATEGORIES = new Set(['Ginecología', 'Obstetricia'])

export function dedupFirstOfYear(rows: Res256SourceRow[]): Res256SourceRow[] {
  // Agrupar por (patient_id, category, year) y quedarse con la primera por starts_at
  const firstByGroup = new Map<string, Res256SourceRow>()
  const allRows: Res256SourceRow[] = []

  for (const r of rows) {
    const cat = r.consultationType?.res256_category
    if (!cat || cat === 'NoAplica') continue

    if (!DEDUP_CATEGORIES.has(cat)) {
      allRows.push(r)
      continue
    }

    const patientId = r.patient?.id ?? r.appointment.id  // fallback si patient null (no debería pasar acá)
    const year = new Date(r.appointment.starts_at).getUTCFullYear()
    const key = `${patientId}::${cat}::${year}`

    const existing = firstByGroup.get(key)
    if (!existing) {
      firstByGroup.set(key, r)
    } else if (r.appointment.starts_at < existing.appointment.starts_at) {
      firstByGroup.set(key, r)
    }
  }

  return [...allRows, ...firstByGroup.values()]
}
