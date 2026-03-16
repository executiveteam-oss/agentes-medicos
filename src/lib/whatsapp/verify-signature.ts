// ============================================================
// Verificación HMAC SHA-256 de webhooks de Meta/WhatsApp
// Meta firma cada POST con X-Hub-Signature-256 usando el App Secret
// Docs: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
// ============================================================

import { createHmac } from 'crypto'

/**
 * Verifica que el payload del webhook fue firmado por Meta.
 * @param rawBody - El body como string (sin parsear)
 * @param signature - Valor del header X-Hub-Signature-256 (formato: "sha256=xxxx")
 * @returns true si la firma es válida
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET

  // Si no hay app secret configurado, loguear warning y permitir (para desarrollo)
  if (!appSecret) {
    console.warn('[Webhook] WHATSAPP_APP_SECRET no configurado — firma no verificada')
    return true
  }

  if (!signature) {
    console.warn('[Webhook] Falta header X-Hub-Signature-256')
    return false
  }

  // El header viene como "sha256=<hash>"
  const expectedSignature = 'sha256=' + createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex')

  // Comparación segura contra timing attacks
  if (signature.length !== expectedSignature.length) return false

  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  try {
    return require('crypto').timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return signature === expectedSignature
  }
}
