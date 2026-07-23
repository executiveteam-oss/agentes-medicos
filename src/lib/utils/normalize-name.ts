// ============================================================
// Normalización de nombres para display.
// Usado al derivar el full_name de un usuario Doctor desde el nombre del
// médico (que está en MAYÚSCULAS en la DB) → "Juan Diego Villegas".
// ============================================================

/**
 * Convierte un nombre a Title Case: primera letra de cada palabra en mayúscula,
 * el resto en minúscula. Colapsa espacios múltiples y recorta extremos.
 * Preserva tildes y ñ. Ej: "ANGELICA  MARIA MONTAÑO" → "Angelica Maria Montaño".
 */
export function toTitleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}
