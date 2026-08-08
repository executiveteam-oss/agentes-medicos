// ============================================================
// Escalación determinista de servicios con regla escalate_human (Capa 0-style).
//
// PROBLEMA que resuelve: hoy la escalación de un servicio 🚨 escalate_human
// depende de que el LLM lea el marcador del prompt (capa A) y el executor
// bloquee la cita (capa B). Entre las dos, el LLM ya le prometió a la paciente
// que la agenda. Con modelos que no siempre obedecen el marcador (Haiku falló
// colposcopia), la promesa equivocada llega igual.
//
// FIX: detectar por keyword ANTES del LLM. Si el mensaje nombra un servicio
// ruleado, se escala sin que el modelo redacte → nunca promete. Model-independent.
//
// PRINCIPIO (igual que Capa 0): tolerar el EXCESO. "Me hicieron una colposcopia
// el año pasado, quiero un control" dispara aunque no pida colposcopia — está
// bien: escala, un humano lo resuelve en 30 segundos. Falso negativo (no escalar
// una colposcopia real) es el costo caro; falso positivo es barato.
//
// Lista CURADA (Algia, piloto). El cron de cobertura (escalate-coverage-check)
// alerta si aparece un servicio ruleado nuevo que estas keywords no cubren —
// para que la lista no se desincronice en silencio.
// ============================================================

import { normalizeForSafety } from './crisis-patterns'

/**
 * Grupos de keywords por procedimiento ruleado. `re` corre sobre texto YA
 * normalizado (minúsculas, sin tildes, sin puntuación). `label` es cómo se
 * nombra el servicio en el mensaje de escalación a la paciente.
 */
export const ESCALATE_SERVICE_KEYWORDS: { re: RegExp; label: string; key: string }[] = [
  { re: /\bcolposcopia\b/, label: 'colposcopia', key: 'colposcopia' },
  { re: /\bvulvoscopia\b/, label: 'vulvoscopia', key: 'vulvoscopia' },
  // `histero(s)?copia` tolera el typo "histerocopia" (sin la 's') — así se llama
  // el CT de ablación en Algia. Sin esto, el cron de cobertura marcaría ese
  // servicio ruleado como descubierto.
  { re: /\b(biopsia|histero(s)?copia)\b/, label: 'ese procedimiento', key: 'biopsia_histeroscopia' },
  { re: /\bmapeo\b/, label: 'la ecografía de mapeo', key: 'mapeo' },
  { re: /\bcitologia\b/, label: 'la citología', key: 'citologia' },
  { re: /\b(pos ?quirurgico|post ?quirurgico)\b/, label: 'el control posquirúrgico', key: 'posquirurgico' },
  { re: /\b(diu|dispositivo intrauterino)\b/, label: 'el procedimiento de DIU', key: 'diu' },
  // Sedación es una condición TRANSVERSAL (cualquier servicio bajo sedación va a
  // humano), no un procedimiento puntual. La keyword atrapa el pedido sin depender
  // de qué CT sea. Sobre-detección tolerada igual que el resto de la capa.
  { re: /\b(sedacion|anestesia|sedado|sedada)\b/, label: 'el servicio con sedación', key: 'sedacion' },
]

/**
 * ¿El mensaje de la paciente nombra un servicio con regla escalate_human?
 * Determinista, no depende del LLM. Devuelve el label para el mensaje de escalación.
 */
export function detectEscalateService(text: string): { matched: boolean; label?: string; key?: string } {
  const n = normalizeForSafety(text)
  for (const { re, label, key } of ESCALATE_SERVICE_KEYWORDS) {
    if (re.test(n)) return { matched: true, label, key }
  }
  return { matched: false }
}

/**
 * CHECK DE COBERTURA (anti-desincronización). Dada la lista de NOMBRES de los
 * consultation_types con regla escalate_human ACTIVA, devuelve los que NINGUNA
 * keyword cubriría. Si devuelve algo → hay un servicio ruleado que el detector
 * determinista NO atrapa → hay que agregar su keyword. Lo corre el cron diario.
 *
 * Verifica cobertura a nivel NOMBRE del servicio: normaliza el nombre y le pasa
 * el detector. Si el nombre no matchea ninguna keyword, la paciente que lo pida
 * (con ese término) tampoco va a matchear → descubierto.
 */
export function findUncoveredEscalateServices(activeCtNames: string[]): string[] {
  const uncovered: string[] = []
  for (const name of activeCtNames) {
    if (!detectEscalateService(name).matched) uncovered.push(name)
  }
  return uncovered
}

// ============================================================
// COMPUERTA DE INTENCIÓN INFORMATIVA (versión acotada: precio y cobertura).
//
// POR QUÉ: el detector de arriba mira la PALABRA, no la intención. Una paciente
// escribió "¿me puede informar qué vale el mapeo?" y la conversación se escaló
// sin que nadie le respondiera — solo quería un precio, y el precio particular
// el agente lo sabe dar.
//
// El principio de sobre-escalar sigue en pie para todo lo demás. Esto abre UNA
// sola puerta: preguntas de PRECIO o COBERTURA, y solo cuando NO hay ninguna
// señal de querer agendar.
//
// Deliberadamente NO incluye "qué es" ni "en qué consiste": esas respuestas
// rozan lo clínico y esa puerta no se abre sin decisión médica.
// ============================================================

/** Pregunta por plata o por cobertura. */
const PRICE_INTENT = /\b(cuanto (vale|cuesta|sale|es)|que (vale|precio|valor|costo)|precio|valor|costo|tarifa|cubre|cubierto|cobertura|copago|cuota moderadora)\b/

/**
 * Señales de querer AGENDAR. Si aparece alguna, manda ésta: la escalación
 * ocurre aunque también haya preguntado el precio.
 * "¿Cuánto vale el mapeo y me lo agendás?" → escala.
 */
// Se usan RAÍCES, no formas exactas: con \bagenda\b se escapaba "me lo agendas",
// que es justo el caso que tiene que escalar. Errar hacia escalar es el lado
// barato del error.
const BOOKING_INTENT = /\b(agend\w*|cita\w*|citar\w*|separ\w*|reserv\w*|program\w*|disponibilidad|cupo\w*|horario\w*|hora dispon\w*|quiero|quisiera|necesito|me lo (pueden|puede) hacer|para cuando|cuando (puedo|pueden|hay))\b/

/**
 * ¿Este mensaje es SOLO una consulta de precio/cobertura sobre un servicio
 * ruleado? Si sí, el call site NO escala y deja que el agente responda.
 * Puro texto, sin DB — testeable en aislamiento.
 */
export function isPriceOnlyQuestion(text: string): boolean {
  const n = normalizeForSafety(text)
  if (!PRICE_INTENT.test(n)) return false
  if (BOOKING_INTENT.test(n)) return false
  return true
}
