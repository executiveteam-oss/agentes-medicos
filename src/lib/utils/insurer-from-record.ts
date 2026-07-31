// ============================================================
// GUARD: la entidad del REGISTRO (patients.entidad, derivada del histórico
// iSalud) puede alimentar el contexto del agente como aseguradora conocida,
// PERO nunca habilita modo 'particular'. El modo particular solo vale si la
// paciente lo declara en el chat (protege la regla de precios: particular →
// revela precio). Por eso, si la entidad del registro es "PARTICULAR", este
// helper devuelve null → el agente no asume modalidad y la pregunta.
// El registro produce: una aseguradora (EPS/prepagada) o null. Nunca particular.
// ============================================================

function normalize(s: string): string {
  return s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

// Valores que NO son una aseguradora: no habilitan convenio ni particular.
// PARTICULAR es el caso real hoy (133); el resto es defensa para derivaciones
// futuras (la columna aseguradora de iSalud podría producirlos).
const NO_INSURER = new Set([
  'PARTICULAR', 'SIN ASEGURADORA', 'SIN EPS', 'NINGUNA', 'NINGUNO',
  'NO APLICA', 'N/A', 'NA', '-', '.', 'X',
])

export function insurerFromRecord(entidad: string | null | undefined): string | null {
  if (!entidad) return null
  const trimmed = entidad.trim()
  if (!trimmed) return null
  if (NO_INSURER.has(normalize(trimmed))) return null
  return trimmed
}
