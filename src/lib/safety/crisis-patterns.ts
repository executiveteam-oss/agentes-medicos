// ============================================================
// Capa 0 de seguridad — detectores deterministas (puros, sin DB/red).
// Principio: ante ambigüedad, SOBRE-DETECTAR crisis. Un caso sin calificador
// inequívoco de modismo va al lado de crisis. Ver spec §3/§6.
// Las keywords viven acá (código), NO en config por-clínica.
// ============================================================

/** Normaliza para matchear: minúsculas, sin acentos, sin puntuación,
 *  colapsa espacios y letras repetidas (3+). Tolera tildes/mayúsculas/typos. */
export function normalizeForSafety(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // quitar diacriticos (acentos)
    .replace(/(.)\1{2,}/g, '$1')      // colapsar 3+ repeticiones (holaaa → hola)
    .replace(/[^\w\s]/g, ' ')         // puntuación → espacio
    .replace(/\s+/g, ' ')
    .trim()
}

// Cola de modismo que DESACTIVA el match de "morir" (calificador inequívoco).
const IDIOM_TAIL = '(?! (de (la |el |las |los )?(pena|verguenza|risa|susto|aburrimiento|ganas|hambre|sueno|frio|calor|sed|amor|miedo|nervios)|por ))'

// Patrones de crisis. Cada uno corre sobre el texto YA normalizado.
const CRISIS_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(suicid|suisid)/, label: 'suicidio' },
  { re: new RegExp(`\\b(matarme|me mato|me voy a matar|me quiero matar|quiero matarme)\\b(?! de )`), label: 'matarse' },
  { re: new RegExp(`\\b(me )?(quiero|quisiera) morir(me)?\\b${IDIOM_TAIL}`), label: 'quiero morir' },
  { re: /\b(quitarme la vida|acabar con mi vida|terminar con mi vida|acabar con todo)\b/, label: 'quitarse la vida' },
  { re: /\b(no quiero vivir|no quiero seguir viviendo|ya no quiero vivir|no vale la pena vivir|no le veo sentido a (la vida|nada|vivir))\b/, label: 'no quiero vivir' },
  { re: /\b(mejor muerto|estaria mejor muerto|prefiero estar muerto|estarian mejor sin mi)\b/, label: 'mejor muerto' },
  { re: /\b(hacerme dano|lastimarme|autolesi|cortarme (las venas|los brazos))/, label: 'autolesion' },
  { re: /\b(ya no aguanto mas|desaparecer para siempre)\b/, label: 'indirecto' },
  // "no quiero seguir aca" (bare) = crisis (ambiguo → crisis). Se excluye solo
  // la continuación claramente inocua ("...en la fila", "...esperando").
  { re: /\bno quiero seguir aca\b(?! (en (la |esta )?fila|esperando|haciendo fila))/, label: 'indirecto-aca' },
]

const HUMAN_REQUEST_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(humano|ser humano|agente humano)\b/, label: 'humano' },
  { re: /\b(persona real|con una persona|con alguien real|alguien del consultorio)\b/, label: 'persona' },
  { re: /\b(hablar con alguien|hablar con una persona|pasame con|comunicarme con alguien)\b/, label: 'hablar con alguien' },
  { re: /\b(asesor|secretaria)\b/, label: 'asesor' },
  // "escalar" solo con intención de transferencia — NO la palabra "escala"
  // suelta ("escala del dolor" es frecuente en una clínica de dolor pélvico).
  { re: /\bescala(r)? a (un |una )?(humano|persona|asesor|alguien|secretaria)\b/, label: 'escalar a' },
]

export function detectCrisis(text: string): { matched: boolean; pattern?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label } of CRISIS_PATTERNS) {
    if (re.test(n)) return { matched: true, pattern: label }
  }
  return { matched: false }
}

export function detectHumanRequest(text: string): { matched: boolean; pattern?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label } of HUMAN_REQUEST_PATTERNS) {
    if (re.test(n)) return { matched: true, pattern: label }
  }
  return { matched: false }
}
