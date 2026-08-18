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


/**
 * "Dr." / "Dra." a partir de `doctors.gender`. UNA sola respuesta a "¿cómo se
 * lo nombra?".
 *
 * El 2026-08-18 agregué una columna `title` para esto sin ver que `gender` ya
 * existía y ya estaba poblada — y que el system prompt ya la usaba. Dos fuentes
 * para la misma pregunta es el error que este repo paga siempre; se elimina la
 * que sobra (`title`) y queda ésta.
 *
 * Sin dato NO se antepone nada: preferimos no decir nada antes que decirlo mal.
 * La heurística vieja lo deducía de la especialidad y erraba en 6 de 7 médicos.
 */
export function tratamientoMedico(gender: string | null | undefined): string {
  if (gender === 'M') return 'Dr.'
  if (gender === 'F') return 'Dra.'
  return ''
}

/** Nombre listo para un mensaje a la paciente: tratamiento + Title Case. */
export function nombreMedicoParaPaciente(name: string, gender: string | null | undefined): string {
  const t = tratamientoMedico(gender)
  return t ? `${t} ${toTitleCase(name)}` : toTitleCase(name)
}
