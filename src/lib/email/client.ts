// ============================================================
// Cliente de email — Resend (solo si está configurado)
// Si RESEND_API_KEY no existe, los envíos se saltan silenciosamente
// ============================================================

import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

const FROM_EMAIL = process.env.EMAIL_FROM ?? 'consultorio@resend.dev'

interface SendEmailParams {
  to: string
  subject: string
  html: string
}

/**
 * Enviar email vía Resend.
 * Retorna { ok: true } si se envió, o { ok: false } si no hay API key o hubo error.
 * Nunca lanza excepciones — falla silenciosamente si Resend no está configurado.
 */
export async function sendEmail(params: SendEmailParams): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.warn('[Email] RESEND_API_KEY no configurada — email omitido')
    return { ok: false, error: 'Email no configurado' }
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      html: params.html,
    })

    if (error) {
      console.error('[Email] Error Resend:', error)
      return { ok: false, error: error.message }
    }

    return { ok: true }
  } catch (err) {
    console.error('[Email] Error enviando:', err)
    return { ok: false, error: 'Error enviando email' }
  }
}
