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
  { re: /\b(biopsia|histeroscopia)\b/, label: 'ese procedimiento', key: 'biopsia_histeroscopia' },
  { re: /\b(pos ?quirurgico|post ?quirurgico)\b/, label: 'el control posquirúrgico', key: 'posquirurgico' },
  { re: /\b(diu|dispositivo intrauterino)\b/, label: 'el procedimiento de DIU', key: 'diu' },
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
