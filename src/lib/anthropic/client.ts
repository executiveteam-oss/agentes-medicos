// ============================================================
// Cliente Anthropic (Claude AI) — Singleton
// Se crea UNA vez y se reutiliza en toda la app
// Modelo: claude-sonnet para balance entre calidad y costo
// ============================================================

import Anthropic from '@anthropic-ai/sdk'

// Usar placeholder en build-time para que no falle la compilación.
// En runtime la variable real debe estar configurada en Vercel.
const apiKey = process.env.ANTHROPIC_API_KEY ?? 'placeholder'

// Singleton: una sola instancia del cliente para toda la app
// Esto es eficiente porque reutiliza la conexión HTTP
export const anthropic = new Anthropic({
  apiKey,
})

// Configuración del modelo — centralizada para cambiar fácil
export const CLAUDE_CONFIG = {
  model: 'claude-sonnet-4-20250514',    // Sonnet: rápido y bueno para conversaciones
  maxTokens: 1024,                       // Respuestas cortas para WhatsApp
  temperature: 0.3,                      // Baja = respuestas más consistentes
} as const
