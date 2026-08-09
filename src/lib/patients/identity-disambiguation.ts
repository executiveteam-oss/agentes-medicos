// ============================================================
// Desambiguación DETERMINISTA de identidad cuando un teléfono matchea 2+ pacientes
// (familias que comparten número). NO es criterio del modelo.
//
// REGLA DURA DE PRIVACIDAD: nunca se revelan los nombres encontrados. Confirmarle
// a quien escribe que "María/Ana/Sofía" son pacientes de una clínica de ginecología
// ya es exponer datos. El agente pregunta ABIERTO ("¿tu nombre completo o documento?")
// y este módulo matchea la respuesta contra los candidatos. Hasta que resuelva a UNO:
// cero datos (ni citas, ni nombre, ni entidad).
// ============================================================

export interface PatientCandidate {
  id: string
  name: string
  document_number: string | null
}

export type DisambiguationReason = 'matched' | 'no_match' | 'multiple_match'
export interface DisambiguationResult {
  resolved: PatientCandidate | null
  reason: DisambiguationReason
}

/** Prompt determinista (no lo redacta el modelo). No lista nombres. */
export const IDENTITY_DISAMBIGUATION_PROMPT =
  'Hola 👋 Para cuidar tu información, primero necesito confirmar con quién hablo. ' +
  '¿Me indicas tu nombre completo o tu número de documento?'

/** Mensaje cuando la respuesta no permite resolver (sigue sin revelar nombres). */
export const IDENTITY_RETRY_PROMPT =
  'No pude confirmar tu identidad con esos datos. ¿Me escribes tu nombre completo ' +
  '(nombres y apellidos) o tu número de documento, por favor?'

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes (marcas combinantes)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const onlyDigits = (s: string): string => s.replace(/\D/g, '')

/**
 * Resuelve la identidad desde la respuesta libre del paciente contra los candidatos
 * del teléfono. Determinista:
 *  1) Documento: si la respuesta trae >=5 dígitos que igualan el document_number de
 *     exactamente un candidato -> match.
 *  2) Nombre: >=2 tokens del nombre de un candidato presentes en la respuesta, y unico.
 * Devuelve el candidato UNICO o null (con motivo). Nunca expone nombres.
 */
export function resolveIdentityFromReply(
  reply: string,
  candidates: PatientCandidate[],
): DisambiguationResult {
  if (!reply || candidates.length === 0) return { resolved: null, reason: 'no_match' }

  // 1) Documento (senal fuerte)
  const replyDigits = onlyDigits(reply)
  if (replyDigits.length >= 5) {
    const byDoc = candidates.filter(
      (c) => c.document_number && onlyDigits(c.document_number) === replyDigits,
    )
    if (byDoc.length === 1) return { resolved: byDoc[0], reason: 'matched' }
    if (byDoc.length > 1) return { resolved: null, reason: 'multiple_match' }
  }

  // 2) Nombre: tokens del candidato presentes en la respuesta (>=2: nombre + apellido).
  //    Con familiares de mismo apellido, el nombre de pila desambigua: si un candidato
  //    tiene ESTRICTAMENTE mas tokens coincidentes, gana. Empate en el maximo -> ambiguo.
  const replyTokens = new Set(normalizeName(reply).split(' ').filter(Boolean))
  const scored = candidates
    .map((c) => {
      const cTokens = normalizeName(c.name).split(' ').filter(Boolean)
      const hits = cTokens.filter((t) => replyTokens.has(t)).length
      return { c, hits }
    })
    .filter((s) => s.hits >= 2)
  if (scored.length === 0) return { resolved: null, reason: 'no_match' }
  if (scored.length === 1) return { resolved: scored[0].c, reason: 'matched' }
  const maxHits = Math.max(...scored.map((s) => s.hits))
  const top = scored.filter((s) => s.hits === maxHits)
  if (top.length === 1) return { resolved: top[0].c, reason: 'matched' }
  return { resolved: null, reason: 'multiple_match' }
}
