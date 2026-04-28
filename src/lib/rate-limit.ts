// ============================================================
// Rate Limiter — Upstash Redis en prod. Ver docs/RATE_LIMITING.md.
// Si UPSTASH_* env vars faltan, cae a in-memory (NO recomendado en serverless).
//
// Two APIs:
// - checkRateLimit() — sync, for webhook/cron/auth (fire-and-forget Upstash)
// - checkRateLimitAsync() — async, for chatbot (awaits Upstash properly)
// ============================================================

import { timingSafeEqual } from 'crypto'

// ---- Backend selection ----

type Backend = 'upstash' | 'memory'
let backend: Backend = 'memory'
let upstashRatelimit: typeof import('@upstash/ratelimit').Ratelimit | null = null

// Lazy init — runs once per process
let initPromise: Promise<void> | null = null

async function ensureInit() {
  if (initPromise) return initPromise
  initPromise = doInit()
  return initPromise
}

async function doInit() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    try {
      const { Redis } = await import('@upstash/redis')
      const { Ratelimit } = await import('@upstash/ratelimit')

      const redis = new Redis({ url, token })
      await redis.ping()

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

// ---- In-memory store (persists via globalThis in dev mode) ----

interface RateLimitEntry {
  count: number
  resetAt: number
}

// Use globalThis to survive HMR in Next.js dev mode
const g = globalThis as unknown as { __rateLimitStore?: Map<string, RateLimitEntry> }
if (!g.__rateLimitStore) g.__rateLimitStore = new Map()
const memoryStore = g.__rateLimitStore

// Clean expired entries every 60s
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

// ---- Upstash limiter cache ----

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

// ---- Types ----

interface RateLimitConfig {
  maxRequests: number
  windowSeconds: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

// ---- Public API: SYNC (for webhook, cron, auth — no change to existing behavior) ----

/**
 * Sync rate limit check. Uses memory as primary.
 * Upstash runs fire-and-forget in background for cross-instance sync.
 * Existing call sites (webhook, cron, auth) use this — DO NOT CHANGE.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  // Trigger lazy init (non-blocking)
  ensureInit()

  if (backend === 'upstash') {
    const limiter = getUpstashLimiter(config)
    if (limiter) {
      limiter.limit(key).then((result) => {
        if (!result.success) {
          memoryStore.set(key, { count: config.maxRequests + 1, resetAt: result.reset })
        }
      }).catch(() => { /* Upstash failure — memory handles it */ })
    }
  }

  return checkMemoryRateLimit(key, config)
}

// ---- Public API: ASYNC (for chatbot — awaits Upstash properly) ----

/**
 * Async rate limit check. Awaits Upstash if available.
 * Falls back to memory if Upstash is not configured.
 * Use this for endpoints that can tolerate ~50ms extra latency (chatbot).
 */
export async function checkRateLimitAsync(
  key: string,
  config: RateLimitConfig,
  logPrefix?: string
): Promise<RateLimitResult> {
  await ensureInit()

  // Try Upstash first (authoritative if available)
  if (backend === 'upstash') {
    const limiter = getUpstashLimiter(config)
    if (limiter) {
      try {
        const result = await limiter.limit(key)
        const rateLimitResult: RateLimitResult = {
          allowed: result.success,
          remaining: result.remaining,
          resetAt: result.reset,
        }

        // Sync memory store for consistency
        if (!result.success) {
          memoryStore.set(key, { count: config.maxRequests + 1, resetAt: result.reset })
        }

        if (logPrefix) {
          console.log(`[${logPrefix}] backend=upstash key=${key} allowed=${result.success} remaining=${result.remaining}/${config.maxRequests}`)
        }

        return rateLimitResult
      } catch (err) {
        if (logPrefix) {
          console.warn(`[${logPrefix}] Upstash failed, falling back to memory:`, err instanceof Error ? err.message : err)
        }
        // Fall through to memory
      }
    }
  }

  // Memory fallback
  const result = checkMemoryRateLimit(key, config)

  if (logPrefix) {
    const entry = memoryStore.get(key)
    console.log(`[${logPrefix}] backend=memory key=${key} allowed=${result.allowed} count=${entry?.count ?? 0}/${config.maxRequests}`)
  }

  return result
}

// ---- Predefined configs ----

export const RATE_LIMITS = {
  /** /api/webhooks/whatsapp — 30 req/min per phone */
  webhook: { maxRequests: 30, windowSeconds: 60 },
  /** /api/cron/* — 5 req/min */
  cron: { maxRequests: 5, windowSeconds: 60 },
  /** All other /api/* — 60 req/min per IP */
  general: { maxRequests: 60, windowSeconds: 60 },
  /** /api/chatbot/help — 20 req/min per user */
  chatbotRpm: { maxRequests: 20, windowSeconds: 60 },
  /** /api/chatbot/help — 200 req/day per user */
  chatbotRpd: { maxRequests: 200, windowSeconds: 86400 },
} as const

/**
 * Extract client IP from request
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
