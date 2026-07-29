// ============================================================
// Cliente Anthropic (Claude AI) — Singleton
// Se crea UNA vez y se reutiliza en toda la app
// Modelo: claude-sonnet-5 para balance entre calidad y costo
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
// NOTA: Sonnet 5 rechaza temperature/top_p/top_k con un 400. Por eso ya no
// hay temperature acá — la consistencia se logra por prompt, no por sampling.
// El thinking se desactiva en el call site (appointment-agent.ts) para no
// gastar tokens de razonamiento ni arriesgar truncar la respuesta corta.
export const CLAUDE_CONFIG = {
  // Haiku 4.5 (decisión 2026-07-29 tras A/B riguroso): ~4× más barato que Sonnet 5,
  // completa reservas, no inventa servicios. Sus huecos (escalación de servicios
  // ruleados, hedge en bordes, slips de tono) se cerraron con: escalación
  // determinista pre-LLM (escalate-service-matcher), regla anti-hedge, Dr./Dra.
  // explícito por médico. Ver A/B en scripts/battery-*.md.
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 1024,                       // Respuestas cortas para WhatsApp
} as const
