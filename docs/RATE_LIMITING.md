# Rate Limiting — Upstash Redis

## Overview

Omuwan usa [Upstash Redis](https://upstash.com) como rate limiter persistente en produccion. Esto protege contra abuso en endpoints publicos (webhook WhatsApp, login, API routes) de forma consistente entre todas las instancias serverless de Vercel.

Si las env vars de Upstash no estan configuradas, el sistema cae a un fallback in-memory con `Map`. Este fallback **NO es recomendado en produccion** porque cada instancia serverless tiene su propio Map independiente — un atacante puede evadir los limites simplemente generando multiples instancias.

## Env vars requeridas

```
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxx...
```

Ambas deben estar configuradas en Vercel (Settings → Environment Variables) para production y preview.

## Thresholds actuales

| Endpoint | Key | Max requests | Ventana | Notas |
|----------|-----|-------------|---------|-------|
| WhatsApp webhook (POST) | `webhook:phone:{phone}` | 30 | 60s | Por numero de telefono |
| WhatsApp webhook (POST) | `webhook:ip:{ip}` | 60 | 60s | Por IP (proteccion adicional) |
| Cron jobs | `cron:{name}` | 5 | 60s | Previene ejecucion duplicada |
| Patient export/forget | `patient-*:{ip}` | 60 | 60s | Por IP |
| Google Sheets setup | `sheets:{ip}` | 60 | 60s | Por IP |
| Login | `login:{email}` | 5 | 900s (15 min) | Por email, previene brute force |
| Resend verification | `resend:{email}` | 3 | 300s (5 min) | Por email |
| Forgot password | `forgot:{email}` | 3 | 300s (5 min) | Por email |

## Comportamiento

### Con Upstash (produccion)
- Lazy init: se conecta en el primer request que use rate limiting
- Usa sliding window algorithm via `@upstash/ratelimit`
- Counters persistentes y compartidos entre todas las instancias serverless
- Si Upstash falla en runtime: fallback silencioso a in-memory (no crashea)

### Sin Upstash (fallback)
- Usa `Map<string, {count, resetAt}>` en memoria
- Solo protege dentro de una misma instancia serverless
- Limpieza de entradas expiradas cada 60 segundos
- Log al startup: `[RateLimit] ℹ️ No UPSTASH env vars — using in-memory fallback`

## Verificar que esta activo

Buscar en Vercel logs (Runtime Logs):

```
[RateLimit] ✅ Upstash Redis connected     → Upstash activo
[RateLimit] ℹ️ No UPSTASH env vars          → Fallback in-memory (revisar env vars)
[RateLimit] ⚠️ Upstash init failed          → Error de conexion (revisar URL/token)
```

Comando:
```bash
npx vercel logs --scope executiveteam-oss-projects | grep -i "ratelimit\|upstash"
```

## Archivos

- `src/lib/rate-limit.ts` — implementacion del rate limiter
- `vercel.json` — cron schedules (los crons tambien estan rate-limited)

## Nota tecnica

`checkRateLimit()` es sincrona pero Upstash es asincrono. La solucion es fire-and-forget el check de Upstash y usar memory como bridge sincrono. Esto significa que hay una ventana de ~50-200ms en la primera request de una instancia nueva donde el counter de Upstash aun no se ha sincronizado. En practica, el margen de 30 req/min es suficiente para absorber esto.
