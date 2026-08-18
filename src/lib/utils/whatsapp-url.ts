// ============================================================
// Helper para "click-to-chat" de WhatsApp — feature encuesta manual.
//
// Diferencia con sendWhatsAppMessage:
//   sendWhatsAppMessage envía por Meta API (nuestro server → paciente).
//   Este helper solo construye la URL wa.me que se abre en el browser de
//   la secretaria — el mensaje lo envía ELLA con su propio WhatsApp,
//   no Omuwan. Por eso no requiere template aprobado ni ventana 24h.
// ============================================================

import { normalizePhone } from './dates'

/**
 * Validación estricta de celular colombiano.
 * Requiere: post-normalizePhone tiene forma exacta `+57 3XX XXXXXXX`
 * (13 chars con +, empieza con +57, tercer dígito real es 3, total 12 dígitos).
 *
 * Fijo colombiano queda excluido — el paciente no lo va a leer por WhatsApp.
 * Otro país queda excluido — Omuwan hoy solo opera Colombia (revisar cuando
 * escale).
 */
export function isValidColombianMobile(phone: string | null | undefined): boolean {
  if (!phone || typeof phone !== 'string') return false
  const normalized = normalizePhone(phone.trim())
  // Post-normalize: +57NNNNNNNNNN, celular colombiano empieza con 3
  return /^\+573\d{9}$/.test(normalized)
}

/**
 * Construye la URL `wa.me/57NNNNNNNNNN?text=<encoded>`.
 * Devuelve null si el teléfono no es un celular colombiano válido.
 *
 * IMPORTANTE: wa.me rechaza `+` en el path. Se pasa solo dígitos.
 */
export function buildWhatsAppUrl(phone: string, message: string): string | null {
  if (!isValidColombianMobile(phone)) return null
  const normalized = normalizePhone(phone.trim())
  // "+57NNNNNNNNNN" → "57NNNNNNNNNN" (strip +)
  const digitsOnly = normalized.slice(1)
  const encodedMessage = encodeURIComponent(message)
  return `https://wa.me/${digitsOnly}?text=${encodedMessage}`
}


/**
 * ¿Este número es ENVIABLE por WhatsApp?
 *
 * Distinto de `isValidColombianMobile`, y la diferencia importa: en Algia hay
 * 7 pacientes con celular de EE.UU., Panamá, México y Ecuador que hoy reciben
 * mensajes sin problema. Exigirles formato colombiano las dejaría mudas.
 *
 * La regla, entonces, es por país:
 *   - Si el número DICE ser colombiano (+57), tiene que serlo de verdad:
 *     `+573XXXXXXXXX`. Acá cae `+5730000000` —el de la clínica demo—, que no es
 *     un celular de ningún lado: le faltan dos dígitos.
 *   - Cualquier otro país: E.164 laxo (8 a 15 dígitos). No sabemos las reglas
 *     de numeración de cada país y no vamos a inventarlas; solo se descarta lo
 *     que no puede ser un teléfono.
 *
 * Es un chequeo de FORMA, no de existencia: que el número esté bien escrito no
 * quiere decir que alguien conteste.
 */
export function esNumeroEnviable(phone: string | null | undefined): boolean {
  if (!phone || typeof phone !== 'string') return false
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 0) return false

  // Con código de país colombiano: se exige el formato completo.
  if (digits.startsWith('57')) return isValidColombianMobile(phone)

  // SIN código de país pero empezando en 3: es un celular colombiano en formato
  // local, y uno completo tiene 10 dígitos (3XX XXX XXXX). Con menos está
  // INCOMPLETO y no sirve.
  //
  // Este caso se me escapó en la primera versión: "313777578" —9 dígitos, el
  // celular de una paciente cargado a medias en iSalud— no empieza con "57", así
  // que caía en la rama de "otro país", pasaba el largo de 8-15 y se habría
  // intentado el envío. El chequeo existe justamente para eso.
  //
  // El techo de 10 dígitos es lo que evita romper a los extranjeros: +31 6…
  // (Países Bajos) también empieza con 3, pero tiene 11.
  if (digits.startsWith('3') && digits.length <= 10) return isValidColombianMobile(phone)

  return digits.length >= 8 && digits.length <= 15
}
