// ============================================================
// Verificación HMAC SHA-256 de webhooks de Meta/WhatsApp
// Meta firma cada POST con X-Hub-Signature-256 usando el App Secret
// Soporta: global WHATSAPP_APP_SECRET o per-clinic app_secret
// Docs: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifica que el payload del webhook fue firmado por Meta.
 * Prueba primero el app secret global (env), luego el de la clínica si se provee.
 * @param rawBody - El body como string (sin parsear)
 * @param signature - Valor del header X-Hub-Signature-256 (formato: "sha256=xxxx")
 * @param clinicAppSecret - App secret de la clínica (opcional, para multi-tenant)
 * @returns true si la firma es válida
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  clinicAppSecret?: string | null
): boolean {
  const globalSecret = process.env.WHATSAPP_APP_SECRET

  // Sin app secret configurado → rechazar siempre (SECURITY: nunca permitir sin firma)
  if (!globalSecret && !clinicAppSecret) {
    console.error('[Webhook] RECHAZADO: Ningún App Secret configurado — configura WHATSAPP_APP_SECRET')
    return false
  }

  if (!signature) {
    console.warn('[Webhook] Falta header X-Hub-Signature-256')
    return false
  }

  // Probar con el global primero, luego con el de la clínica
  const secrets = [globalSecret, clinicAppSecret].filter(Boolean) as string[]

  for (const secret of secrets) {
    if (verifyWithSecret(rawBody, signature, secret)) {
      return true
    }
  }

  return false
}

function verifyWithSecret(rawBody: string, signature: string, secret: string): boolean {
  const expectedSignature = 'sha256=' + createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  if (signature.length !== expectedSignature.length) return false

  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  try {
    return timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    // SECURITY: nunca usar === para comparar firmas (timing attack)
    return false
  }
}
