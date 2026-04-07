// ============================================================
// Rate Limiter — Protección contra abuso en API routes
//
// TODO: migrar a Vercel KV para seguridad multi-instancia.
// Actualmente usa Map en memoria — solo protege dentro de
// una misma instancia de Vercel. En producción con múltiples
// instancias, un atacante podría evadir los límites.
// ============================================================

import { timingSafeEqual } from 'crypto'

interface RateLimitEntry {
  count: number
  resetAt: number  // timestamp en ms
}

const store = new Map<string, RateLimitEntry>()

// Limpiar entradas expiradas cada 60 segundos
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key)
    }
  }
}, 60_000)

interface RateLimitConfig {
  /** Máximo de requests permitidos en la ventana */
  maxRequests: number
  /** Duración de la ventana en segundos */
  windowSeconds: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

/**
 * Verifica si una solicitud está dentro del límite.
 * @param key - Identificador único (IP, phone, clinicId, etc.)
 * @param config - Configuración del límite
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()
  const windowMs = config.windowSeconds * 1000
  const entry = store.get(key)

  // Si no hay entrada o la ventana expiró, crear nueva
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + windowMs }
  }

  // Incrementar contador
  entry.count++

  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt }
}

// ============================================================
// Configuraciones predefinidas por ruta
// ============================================================

export const RATE_LIMITS = {
  /** /api/webhooks/whatsapp — 30 req/min por teléfono */
  webhook: { maxRequests: 30, windowSeconds: 60 },
  /** /api/dashboard/asistente — 20 req/min por clínica */
  asistente: { maxRequests: 20, windowSeconds: 60 },
  /** /api/cron/* — 5 req/min */
  cron: { maxRequests: 5, windowSeconds: 60 },
  /** Todas las demás /api/* — 60 req/min por IP */
  general: { maxRequests: 60, windowSeconds: 60 },
} as const

/**
 * Extrae la IP del request (Vercel pone la IP real en x-forwarded-for)
 */
export function getClientIp(request: Request): string {
  return (
    (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

/**
 * Verifica el Bearer token de cron jobs con comparación timing-safe.
 * SECURITY: nunca usar === para comparar secrets.
 */
export function verifyCronSecret(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!authHeader || !secret) return false

  const expected = `Bearer ${secret}`

  if (authHeader.length !== expected.length) return false

  try {
    return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  } catch {
    return false
  }
}
