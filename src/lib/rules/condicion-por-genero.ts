// ============================================================
// ¿ESTA PREGUNTA DE CONDICIÓN LE APLICA A ESTE PACIENTE?
//
// El 2026-08-22, a las 14:55, el agente le preguntó a Sebastián Londoño
// —nombre masculino, gender 'M' en la ficha— "¿Estás embarazada actualmente?".
// La regla patient_condition hace lo que dice: le pregunta a cualquiera que
// pida ese servicio, sin mirar a quién.
//
// LA REGLA ES DELIBERADAMENTE MÍNIMA Y ASIMÉTRICA:
//   · gender 'M' explícito  → se omite la pregunta de embarazo
//   · femenino, otro, vacío → se pregunta, igual que hoy
//
// Nunca deja de preguntarle a alguien a quien podría aplicarle. Sobre 14.887
// pacientes de Algia hay 42 con gender 'M' y 812 sin gender: los 812 siguen
// recibiendo la pregunta, que es el lado seguro.
//
// 🚨 LA USAN LOS DOS LADOS. El prompt filtra qué preguntas muestra y el
// executor filtra cuáles exige respondidas. Si sólo filtrara el prompt, el
// backstop seguiría pidiendo una respuesta que nadie preguntó y bloquearía el
// agendamiento con BLOCKED_CONDITION_NOT_ASKED — el paciente quedaría trabado
// por un arreglo pensado para ayudarlo.
// ============================================================

/** Detecta que la pregunta es sobre embarazo. Deliberadamente estrecha: si no
 *  matchea, la pregunta se hace — el default es preguntar. */
const ES_PREGUNTA_DE_EMBARAZO = /\bembaraz\w*|\bgestaci[óo]n\b|\bgestante\b|\bencinta\b/i

/** ¿El paciente es masculino de forma EXPLÍCITA? Sólo 'M'/'masculino'.
 *  null, vacío, 'O' u otra cosa → no, y por lo tanto se pregunta. */
export function esMasculinoExplicito(gender: string | null | undefined): boolean {
  const g = (gender ?? '').trim().toLowerCase()
  return g === 'm' || g === 'masculino' || g === 'male' || g === 'h' || g === 'hombre'
}

/**
 * ¿Hay que OMITIR esta pregunta para este paciente?
 * Hoy sólo hay un motivo: preguntarle por un embarazo a un hombre.
 */
export function omitirCondicionPorGenero(
  question: string | null | undefined,
  gender: string | null | undefined,
): boolean {
  if (!esMasculinoExplicito(gender)) return false
  return ES_PREGUNTA_DE_EMBARAZO.test(question ?? '')
}
