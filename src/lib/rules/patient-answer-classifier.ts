// ============================================================
// Clasificador DETERMINISTA de respuestas de paciente (reglas patient_condition).
//
// El LLM pasa las PALABRAS LITERALES de la paciente; el CÓDIGO decide la
// categoría. Antes el LLM clasificaba (yes/no/ambiguous) y a veces se
// equivocaba — F3: "no estoy segura, llevo días de atraso" → clasificado 'no',
// agendando un embarazo que debía derivarse.
//
// CONSERVADOR a propósito: solo un sí/no CLARO y sin señales de duda produce
// 'yes'/'no'. Cualquier incertidumbre, señales contradictorias, o algo que no
// matchea claramente → 'ambiguous' → deriva a humano. El safe-default es
// clínicamente seguro sin validación médica. Las frases reales se loguean
// (action='patient_condition_answer') para armar la lista definitiva que valida
// una doctora — NO inventamos la lista, la sacamos de lo que dicen las pacientes.
//
// Módulo puro (sin DB) → testeable sin red.
// ============================================================

const normalize = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

// Marcadores de INCERTIDUMBRE — máxima prioridad. Si aparece cualquiera, la
// respuesta es ambigua AUNQUE contenga un sí/no ("creo que no", "no sé").
// Sobre-matchear acá es SEGURO (sesga a derivar). Substring a propósito.
const UNCERTAINTY = [
  'no se', 'no lo se', 'no estoy segur', 'no sabria', 'no sabr', 'ni idea',
  'tal vez', 'talvez', 'quiza', 'capaz', 'puede ser', 'podria ser',
  'creo que', 'creo', 'mas o menos', 'depende', 'posiblemente', 'a lo mejor',
  'no confirm', 'no me he hecho', 'no estoy clar', 'supongo', 'igual no se',
]

// Negación clara (con límite de palabra para no matchear substrings).
const NEGATION = ['no', 'para nada', 'nunca', 'jamas', 'negativo', 'en absoluto', 'ninguna', 'ninguno', 'nada', 'nop', 'nel', 'tampoco']

// Afirmación clara.
const AFFIRMATION = ['si', 'sip', 'claro', 'correcto', 'exacto', 'asi es', 'afirmativo', 'dale', 'por supuesto', 'efectivamente', 'obvio', 'de una', 'positivo', 'asi mismo']

function hasWord(text: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${esc}(\\s|$|[.,!?;])`).test(text)
}

/**
 * Clasifica una respuesta libre a una pregunta sí/no.
 * Orden: incertidumbre gana → contradicción es ambigua → negación/afirmación
 * clara → si nada matchea, ambigua (safe default).
 */
export function classifyYesNo(raw: string): 'yes' | 'no' | 'ambiguous' {
  const t = normalize(raw)
  if (!t) return 'ambiguous'
  if (UNCERTAINTY.some((p) => t.includes(p))) return 'ambiguous'
  const neg = NEGATION.some((p) => hasWord(t, p))
  const aff = AFFIRMATION.some((p) => hasWord(t, p))
  if (neg && aff) return 'ambiguous'
  if (neg) return 'no'
  if (aff) return 'yes'
  return 'ambiguous'
}

/**
 * Clasifica una respuesta libre contra opciones de multiple_choice.
 * Devuelve el id de la opción SOLO si matchea exactamente una; cero o varias
 * coincidencias → 'ambiguous' (safe default = deriva).
 */
export function classifyChoice(raw: string, options: { id: string; label: string }[]): string {
  const t = normalize(raw)
  if (!t) return 'ambiguous'
  const matches = options.filter((o) => {
    const id = normalize(o.id)
    const label = normalize(o.label)
    return t === id || t === label || hasWord(t, label) || (label.length >= 4 && t.includes(label))
  })
  return matches.length === 1 ? matches[0].id : 'ambiguous'
}
