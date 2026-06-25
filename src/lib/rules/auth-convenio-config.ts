// Schema y tipos del condition_config para reglas requires_authorization.
// Bloque 4 — Autorización por convenio. Ver CLAUDE.md.
//
// UNA regla por CT (no múltiples como bloque 3). La lista de convenios
// es un array de strings que se cruza con el eps_name declarado del
// paciente usando normalización tolerante a variantes ortográficas
// (ej. "COLMÉDICA" / "COLMEDICA MEDICINA PREPAGADA S.A." matchean).

import { z } from 'zod'

const MATCH_MODES = ['normalized_name'] as const
export type MatchMode = (typeof MATCH_MODES)[number]

export const AuthConvenioConfigSchema = z.object({
  convenios_que_requieren: z.array(z.string().trim().min(1)).min(1, 'Seleccioná al menos un convenio'),
  message_pedir_archivo: z.string().trim().min(20, 'El mensaje debe tener al menos 20 caracteres').max(500, 'El mensaje no puede exceder 500 caracteres'),
  match_mode: z.enum(MATCH_MODES).default('normalized_name'),
})

export type AuthConvenioConfig = z.infer<typeof AuthConvenioConfigSchema>

/**
 * Normaliza un nombre de convenio para matching tolerante a variantes.
 *
 * Ejemplos (todos producen la misma normalización):
 *   "COLMÉDICA" → "colmedica"
 *   "COLMEDICA MEDICINA PREPAGADA S.A." → "colmedica"
 *   "Colmedica SA" → "colmedica"
 *   "COLMEDICA MEDICINA PREPAGADA SA." → "colmedica"
 *
 * Esto resuelve operativamente la deuda anotada en CLAUDE.md sobre
 * variantes en isalud_import_staging — el matching es tolerante sin
 * requerir cleanup de los datos.
 */
export function normalizeConvenioName(s: string): string {
  if (!s) return ''

  // Lower + sacar acentos comunes (NFD decompose + remove diacritics)
  let n = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

  // Remover sufijos corporativos comunes en Colombia
  n = n
    .replace(/\bs\.?\s*a\.?\s*s?\.?\b/g, ' ')  // S.A., SA, S A, S.A.S
    .replace(/\bltda\.?\b/g, ' ')
    .replace(/\bmedicina\s+prepagada\b/g, ' ')
    .replace(/\bprepagada\b/g, ' ')
    .replace(/\bseguros?\s+de\s+vida\b/g, ' ')
    .replace(/\bseguros?\s+generales\b/g, ' ')
    .replace(/\beps\b/g, ' ')  // sacamos "EPS" solo si es token solo (no parte de palabra)

  // Sacar puntuación y collapse de espacios
  n = n
    .replace(/[.,;:'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return n
}

/**
 * ¿El convenio declarado por el paciente está en la lista de convenios
 * que requieren autorización? Comparación normalizada + substring (un
 * lado contiene al otro), para soportar nombres parciales del paciente.
 *
 * Ejemplos que matchean:
 *   declared="Colmédica", rule=["COLMEDICA MEDICINA PREPAGADA S.A."] → true
 *   declared="Sura prepagada", rule=["SURA"] → true
 *   declared="AXA Colpatria", rule=["AXA"] → true
 *   declared="Allianz Salud", rule=["AXA COLPATRIA"] → false
 */
export function convenioRequiresAuthorization(
  declared: string,
  ruleList: string[],
): boolean {
  if (!declared || ruleList.length === 0) return false
  const dN = normalizeConvenioName(declared)
  if (!dN) return false

  // También comparamos versiones "compactas" (sin espacios) — esto resuelve
  // acrónimos con puntos como "S.O.S." → "s o s" vs rule "SOS" → "sos".
  const dNcompact = dN.replace(/\s+/g, '')

  return ruleList.some((r) => {
    const rN = normalizeConvenioName(r)
    if (!rN) return false
    if (dN === rN || dN.includes(rN) || rN.includes(dN)) return true
    const rNcompact = rN.replace(/\s+/g, '')
    return dNcompact === rNcompact ||
      dNcompact.includes(rNcompact) ||
      rNcompact.includes(dNcompact)
  })
}

/**
 * Reemplaza placeholders {servicio} y {convenio} en el mensaje configurado.
 */
export function fillMessagePlaceholders(
  message: string,
  values: { servicio: string; convenio: string },
): string {
  return message
    .replace(/\{servicio\}/g, values.servicio)
    .replace(/\{convenio\}/g, values.convenio)
}
