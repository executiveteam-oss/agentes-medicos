// ============================================================
// Lógica PURA de etiquetas de paciente (sin DB). Catálogo de la clínica +
// helpers de aplicar/quitar/resolver/renombrar/archivar/eliminar.
// La paciente guarda ids; el nombre/color se resuelve del catálogo.
// ============================================================

export interface ClinicLabel {
  id: string
  name: string
  color: LabelColor
  archived?: boolean
}

// Swatches FIJOS (no hex libre) — la bandeja no puede volverse un arcoíris ilegible.
export const LABEL_SWATCHES = ['amber', 'green', 'blue', 'pink', 'purple', 'red', 'teal', 'gray'] as const
export type LabelColor = (typeof LABEL_SWATCHES)[number]

export function isValidColor(c: string): c is LabelColor {
  return (LABEL_SWATCHES as readonly string[]).includes(c)
}

// Estilo por swatch (bg suave + texto). Consistente en chip, popover y filtro.
export const LABEL_COLOR_STYLES: Record<LabelColor, { bg: string; fg: string }> = {
  amber:  { bg: 'var(--v2-amber-soft)', fg: '#b07d00' },
  green:  { bg: 'var(--v2-green-soft)', fg: 'var(--v2-green-deep)' },
  blue:   { bg: 'rgba(62,116,232,0.14)', fg: '#3E74E8' },
  pink:   { bg: 'var(--v2-pink-soft)', fg: 'var(--v2-pink)' },
  purple: { bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)' },
  red:    { bg: 'var(--v2-red-soft)', fg: 'var(--v2-red)' },
  teal:   { bg: 'rgba(20,170,160,0.14)', fg: '#0E9E93' },
  gray:   { bg: 'var(--v2-bg-deeper)', fg: 'var(--v2-text-subtle)' },
}

/** Normaliza para comparar nombres (evita duplicados por mayúsculas/tildes/espacios). */
export function normalizeLabelName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

export interface ValidateResult { ok: boolean; error?: string; name?: string }

/** Valida un nombre nuevo contra el catálogo (no vacío, ≤40, sin duplicado activo). */
export function validateNewLabel(rawName: string, catalog: ClinicLabel[]): ValidateResult {
  const name = rawName.trim()
  if (!name) return { ok: false, error: 'Escribe un nombre para la etiqueta' }
  if (name.length > 40) return { ok: false, error: 'Máximo 40 caracteres' }
  const norm = normalizeLabelName(name)
  const dup = catalog.find((l) => !l.archived && normalizeLabelName(l.name) === norm)
  if (dup) return { ok: false, error: `Ya existe "${dup.name}"` }
  return { ok: true, name }
}

/** Etiquetas ofrecibles en el selector (no archivadas), ordenadas por nombre. */
export function pickableLabels(catalog: ClinicLabel[]): ClinicLabel[] {
  return catalog.filter((l) => !l.archived).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Resuelve los ids de una paciente a etiquetas completas (incluye archivadas, para
 *  que una etiqueta que se "dejó de usar" se siga viendo donde ya estaba puesta). */
export function resolveLabels(ids: string[], catalog: ClinicLabel[]): ClinicLabel[] {
  const byId = new Map(catalog.map((l) => [l.id, l]))
  return ids.map((id) => byId.get(id)).filter((l): l is ClinicLabel => !!l)
}

/** Agrega/quita un id del array de la paciente (idempotente, sin duplicados). */
export function toggleLabel(current: string[], labelId: string, on: boolean): string[] {
  const set = new Set(current)
  if (on) set.add(labelId)
  else set.delete(labelId)
  return [...set]
}

/** Renombra/recolorea en el catálogo (mismo id → las pacientes no se tocan). */
export function renameInCatalog(catalog: ClinicLabel[], id: string, name: string, color: LabelColor): ClinicLabel[] {
  return catalog.map((l) => (l.id === id ? { ...l, name: name.trim(), color } : l))
}

/** "Dejar de usar" = archivar (soft): sale del selector, se conserva donde ya está. */
export function archiveInCatalog(catalog: ClinicLabel[], id: string): ClinicLabel[] {
  return catalog.map((l) => (l.id === id ? { ...l, archived: true } : l))
}

/** "Eliminar" = sacar del catálogo (el caller además la quita de patients.labels). */
export function deleteFromCatalog(catalog: ClinicLabel[], id: string): ClinicLabel[] {
  return catalog.filter((l) => l.id !== id)
}
