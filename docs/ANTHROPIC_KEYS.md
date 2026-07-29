# Anthropic API keys — estado e higiene

> Anotado 2026-07-28 tras el A/B Sonnet vs Haiku, que secó una cuenta y reveló que los `.env` locales están desalineados.

## Estado actual (verificado)

| Ubicación | Estado | Nota |
|---|---|---|
| **Vercel env `ANTHROPIC_API_KEY`** (producción) | ✅ **financiada y viva** | Es la que usa el agente en prod. Confirmada por probe del webhook (el agente respondió con contenido real el 2026-07-28). Distinta de las tres locales. **No accesible desde acá** (no hay tool de env de Vercel). |
| `.env.production.local` | ❌ **revocada** | `401 authentication_error` |
| `.env.local` | ❌ **revocada** | `401 authentication_error` |
| `.env.local.prod-backup` | ⚠️ **autentica pero SIN crédito** | `GET /v1/models` OK; `messages.create` y `count_tokens` → `400 credit balance too low`. **Es la cuenta que secó el A/B.** |

## La trampa

Cualquier script (`scripts/*.ts`) que lea `ANTHROPIC_API_KEY` de los `.env` locales va a:
- chocar con `401` (las dos primeras), o
- **secar la cuenta de `.env.local.prod-backup`** con llamadas de generación.

Y ojo: **`count_tokens` NO bypassea el gate de crédito** en esa cuenta (lo confirmamos) — no sirve como "medición gratis" si la cuenta está seca.

## Acción manual pendiente (solo la puede hacer quien maneja las keys)

1. Decidir qué cuenta Anthropic es la productiva y confirmar su saldo en la consola.
2. Poner una key de una cuenta **con fondos** en `.env.production.local` (y/o `.env.local`), **editando el archivo directamente** — nunca pegar la key en el chat.
3. Revocar/limpiar las keys muertas para que no queden de trampa.
4. (Opcional pero recomendado) documentar acá cuál cuenta es la productiva, para que la próxima sesión no vuelva a adivinar.

## Por qué importa ya

Con una key financiada en los locales:
- El **A/B Sonnet vs Haiku** se completa (`npx tsx scripts/ab-sonnet-vs-haiku.ts`) — prioridad: alucinación → reglas → multi-turno.
- La **medición exacta del prompt** (`scripts/measure-prompt.ts`) pasa de aproximación `chars/4` a `count_tokens` real.
- Cualquier smoke del agente (ej. validar el reorder del cache-split) puede correr.

Prod NO depende de esto — usa la key de Vercel, que está viva.
