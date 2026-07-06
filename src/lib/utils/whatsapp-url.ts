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
