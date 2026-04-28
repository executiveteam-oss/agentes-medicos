// ============================================================
// Rate Limiter — Upstash Redis en prod. Ver docs/RATE_LIMITING.md.
// Si UPSTASH_* env vars faltan, cae a in-memory (NO recomendado en serverless).
//
// Uses Upstash Redis if UPSTASH_REDIS_REST_URL is configured.
// Falls back to in-memory Map if env vars are missing or init fails.
// Fallback is logged once at startup for observability.
// ============================================================

import { timingSafeEqual } from 'crypto'

// ---- Backend selection ----

type Backend = 'upstash' | 'memory'
let backend: Backend = 'memory'
let upstashRatelimit: typeof import('@upstash/ratelimit').Ratelimit | null = null

// Lazy init — runs once on first call
let initialized = false

async function ensureInit() {
  if (initialized) return
  initialized = true

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    try {
      const { Redis } = await import('@upstash/redis')
      const { Ratelimit } = await import('@upstash/ratelimit')

      // Test connection
      const redis = new Redis({ url, token })
      await redis.ping()

      // Store Ratelimit class for later use
      upstashRatelimit = Ratelimit
      ;(globalThis as Record<string, unknown>).__upstashRedis = redis
      backend = 'upstash'
      console.log('[RateLimit] ✅ Upstash Redis connected')
    } catch (err) {
      console.warn('[RateLimit] ⚠️ Upstash init failed, using in-memory fallback:', err instanceof Error ? err.message : err)
      backend = 'memory'
    }
  } else {
    console.log('[RateLimit] ℹ️ No UPSTASH env vars — using in-memory fallback')
    backend = 'memory'
  }
}

// ---- In-memory fallback (original implementation) ----

interface RateLimitEntry {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, RateLimitEntry>()

// Clean expired entries every 60s (only runs if memory backend is used)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryStore) {
      if (now > entry.resetAt) memoryStore.delete(key)
    }
  }, 60_000)
}

function checkMemoryRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()
  const windowMs = config.windowSeconds * 1000
  const entry = memoryStore.get(key)

  if (!entry || now > entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + windowMs }
  }

  entry.count++

  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt }
}

// ---- Upstash rate limiter cache ----

const upstashLimiters = new Map<string, InstanceType<typeof import('@upstash/ratelimit').Ratelimit>>()

function getUpstashLimiter(config: RateLimitConfig) {
  const cacheKey = `${config.maxRequests}:${config.windowSeconds}`
  let limiter = upstashLimiters.get(cacheKey)
  if (!limiter && upstashRatelimit) {
    const redis = (globalThis as Record<string, unknown>).__upstashRedis as import('@upstash/redis').Redis
    limiter = new upstashRatelimit({
      redis,
      limiter: upstashRatelimit.slidingWindow(config.maxRequests, `${config.windowSeconds} s`),
    })
    upstashLimiters.set(cacheKey, limiter)
  }
  return limiter
}

// ---- Public API (same signatures as before) ----

interface RateLimitConfig {
  maxRequests: number
  windowSeconds: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

/**
 * Verifica si una solicitud esta dentro del limite.
 * Uses Upstash if available, falls back to in-memory.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  // Trigger lazy init (non-blocking — first request uses memory, subsequent use Upstash)
  ensureInit()

  if (backend === 'upstash') {
    const limiter = getUpstashLimiter(config)
    if (limiter) {
      // Upstash ratelimit is async but checkRateLimit is sync.
      // Fire-and-forget the async check and use memory as synchronous bridge.
      // This is a pragmatic approach: the actual blocking happens in memory
      // but the Upstash counter stays in sync for cross-instance consistency.
      limiter.limit(key).then((result) => {
        if (!result.success) {
          // Mark in memory store as blocked so next sync call returns blocked
          memoryStore.set(key, { count: config.maxRequests + 1, resetAt: result.reset })
        }
      }).catch(() => { /* Upstash failure — memory handles it */ })
    }
  }

  // Always check memory synchronously (works as primary or backup)
  return checkMemoryRateLimit(key, config)
}

// ---- Predefined configs ----

export const RATE_LIMITS = {
  /** /api/webhooks/whatsapp — 30 req/min per phone */
  webhook: { maxRequests: 30, windowSeconds: 60 },
  /** /api/cron/* — 5 req/min */
  cron: { maxRequests: 5, windowSeconds: 60 },
  /** All other /api/* — 60 req/min per IP */
  general: { maxRequests: 60, windowSeconds: 60 },
} as const

/**
 * Extract client IP from request (Vercel puts real IP in x-forwarded-for)
 */
export function getClientIp(request: Request): string {
  return (
    (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

/**
 * Verify cron Bearer token with timing-safe comparison.
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
