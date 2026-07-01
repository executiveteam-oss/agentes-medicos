// ============================================================
// Cliente WhatsApp Business Cloud API
// Envía mensajes de texto y marca mensajes como leídos
// Soporta credenciales globales (env) o per-clínica
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
// ============================================================

import type { WhatsAppSendTextPayload } from '@/types/whatsapp'
import { supabaseAdmin } from '@/lib/supabase/admin'

const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0'

/** Credenciales opcionales por clínica */
export interface ClinicWhatsAppCredentials {
  phoneNumberId: string
  accessToken: string
}

// Obtener credenciales — SIEMPRE per-clínica, nunca fallback global
function getConfig(clinicCreds?: ClinicWhatsAppCredentials | null) {
  if (clinicCreds?.phoneNumberId && clinicCreds?.accessToken) {
    return { phoneNumberId: clinicCreds.phoneNumberId, accessToken: clinicCreds.accessToken }
  }

  // Multi-tenant: no usar token global — cada clínica tiene su propio token
  throw new Error('[WhatsApp] clinicCreds requerido — cada mensaje debe usar el token de la clínica específica')
}

/**
 * Envía un mensaje de texto por WhatsApp
 * @param to - Número del paciente SIN el "+" (ej: "573101112233")
 * @param message - Texto del mensaje (máx 4096 caracteres)
 * @param clinicCreds - Credenciales opcionales de la clínica (si no se pasan, usa env vars)
 * @returns ID del mensaje enviado o null si falló
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string,
  clinicCreds?: ClinicWhatsAppCredentials | null
): Promise<string | null> {
  const { phoneNumberId, accessToken } = getConfig(clinicCreds)

  // Truncar si excede el límite de WhatsApp
  const truncatedMessage = message.length > 4096
    ? message.slice(0, 4090) + '...'
    : message

  const payload: WhatsAppSendTextPayload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: truncatedMessage },
  }

  console.log(`[WhatsApp] Enviando mensaje a: ${to.slice(0, 5)}***`)

  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )

    const responseBody = await response.json()

    if (!response.ok) {
      const errorCode = responseBody?.error?.code
      const errorMessage = responseBody?.error?.message ?? 'Error desconocido'

      // Logging detallado por tipo de error
      if (errorCode === 190) {
        console.error(`[WhatsApp] TOKEN EXPIRADO (code ${errorCode}): ${errorMessage}`)
        console.error('[WhatsApp] → Regenera el token en developers.facebook.com > WhatsApp > API Setup')
      } else if (errorCode === 131030) {
        console.error(`[WhatsApp] NÚMERO NO AUTORIZADO (code ${errorCode}): ${errorMessage}`)
        console.error('[WhatsApp] → Agrega el número en developers.facebook.com > WhatsApp > API Setup > "To" phone number')
      } else if (errorCode === 131047) {
        console.error(`[WhatsApp] FUERA DE VENTANA 24H (code ${errorCode}): ${errorMessage}`)
        console.error('[WhatsApp] → El paciente no ha escrito en las últimas 24h. Usa un template aprobado.')
      } else {
        console.error(`[WhatsApp] ERROR ${response.status} (code ${errorCode}): ${errorMessage}`)
        console.error('[WhatsApp] Response completa:', JSON.stringify(responseBody))
      }

      return null
    }

    const messageId = responseBody.messages?.[0]?.id ?? null
    console.log(`[WhatsApp] Mensaje enviado OK. ID: ${messageId}`)
    return messageId
  } catch (error) {
    console.error('[WhatsApp] Error de red (no se pudo conectar a Meta):', error)
    return null
  }
}

/**
 * Envía un documento por WhatsApp (2-step: upload media → send message).
 * Used for .ics calendar invites. Never throws — returns null on failure.
 * @param to - Número del paciente SIN "+" (ej: "573101112233")
 * @param fileBuffer - Buffer del archivo
 * @param filename - Nombre del archivo (ej: "cita.ics")
 * @param mimeType - MIME type (ej: "text/calendar")
 * @param clinicCreds - Credenciales de la clínica
 * @returns ID del mensaje enviado o null si falló
 */
export async function sendWhatsAppDocument(
  to: string,
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  clinicCreds?: ClinicWhatsAppCredentials | null,
): Promise<string | null> {
  let config: { phoneNumberId: string; accessToken: string }
  try {
    config = getConfig(clinicCreds)
  } catch {
    return null
  }

  try {
    // Step 1: Upload media to WhatsApp
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType })
    const formData = new FormData()
    formData.append('file', blob, filename)
    formData.append('messaging_product', 'whatsapp')
    formData.append('type', mimeType)

    const uploadRes = await fetch(
      `${WHATSAPP_API_URL}/${config.phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.accessToken}` },
        body: formData,
      },
    )

    const uploadData = await uploadRes.json()
    if (!uploadData.id) {
      console.error('[WhatsApp] Media upload failed:', JSON.stringify(uploadData).slice(0, 300))
      return null
    }

    // Step 2: Send document message referencing uploaded media
    const res = await fetch(
      `${WHATSAPP_API_URL}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace('+', ''),
          type: 'document',
          document: { id: uploadData.id, filename },
        }),
      },
    )

    const data = await res.json()
    if (data.messages?.[0]?.id) {
      console.log(`[WhatsApp] Documento enviado OK: ${filename} → ${to.slice(0, 5)}***`)
      return data.messages[0].id
    }

    const errorCode = data.error?.code
    if (errorCode === 131047) {
      console.error('[WhatsApp] Document: FUERA DE VENTANA 24H')
    } else {
      console.error('[WhatsApp] Document send error:', JSON.stringify(data).slice(0, 300))
    }
    return null
  } catch (err) {
    console.error('[WhatsApp] Document send failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Marca un mensaje como leído (los dos checks azules ✓✓)
 * @param messageId - ID del mensaje recibido de WhatsApp
 * @param clinicCreds - Credenciales opcionales de la clínica
 */
export async function markAsRead(
  messageId: string,
  clinicCreds?: ClinicWhatsAppCredentials | null
): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig(clinicCreds)

  try {
    await fetch(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      }
    )
  } catch (error) {
    console.error('[WhatsApp] Error marcando como leído:', error)
  }
}

/**
 * Envía un template Meta pre-aprobado.
 *
 * A diferencia de sendWhatsAppMessage (que envía texto libre y solo funciona
 * dentro de la ventana 24h posterior al último mensaje del paciente), este
 * envía una plantilla pre-aprobada por Meta y puede iniciar conversación
 * en cualquier momento — es el patrón obligatorio para mensajes proactivos
 * como recordatorios, encuestas, etc.
 *
 * Meta espera un payload con `components` que combina:
 *  - body params (para las variables {{1}}, {{2}}, ... del cuerpo del template)
 *  - button params (opcional, para variables en URLs dinámicas de botones CTA)
 *
 * El template DEBE existir y estar APROBADO en el Meta Business Manager de
 * la clínica (creds.phoneNumberId). Si no lo está, Meta responde 132001
 * (template no encontrado) o 132000 (template no aprobado).
 *
 * @param to - Número del paciente SIN "+" (ej: "573101112233")
 * @param templateName - Nombre exacto con el que se aprobó en Meta
 * @param languageCode - Código de idioma del template (ej: 'es_CO')
 * @param bodyParams - Array de valores para variables {{1}}, {{2}}, ... en orden
 * @param buttonUrlParam - Valor de la variable {{1}} del botón URL, o null si el
 *                         template no tiene botón dinámico
 * @param clinicCreds - Credenciales de la clínica
 * @returns { ok, messageId } o { ok:false, error, errorCode }
 */
export interface SendTemplateResult {
  ok: boolean
  messageId?: string
  error?: string
  errorCode?: number
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
  buttonUrlParam: string | null,
  clinicCreds?: ClinicWhatsAppCredentials | null,
): Promise<SendTemplateResult> {
  const { phoneNumberId, accessToken } = getConfig(clinicCreds)

  const components: unknown[] = []

  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text })),
    })
  }

  if (buttonUrlParam !== null) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: buttonUrlParam }],
    })
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  }

  console.log(`[WhatsApp:template] "${templateName}" (${languageCode}) → ${to.slice(0, 5)}***`)

  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    )

    const responseBody = await response.json()

    if (!response.ok) {
      const errorCode = responseBody?.error?.code as number | undefined
      const errorMessage = responseBody?.error?.message ?? 'Error desconocido'

      if (errorCode === 132001) {
        console.error(`[WhatsApp:template] TEMPLATE NO EXISTE (132001): "${templateName}" — verificar que esté aprobado en Meta Business Manager de la clínica`)
      } else if (errorCode === 132000) {
        console.error(`[WhatsApp:template] TEMPLATE NO APROBADO (132000): "${templateName}" — pendiente de aprobación en Meta`)
      } else if (errorCode === 132015) {
        console.error(`[WhatsApp:template] TEMPLATE PAUSADO (132015): "${templateName}" — Meta lo pausó por bajo engagement`)
      } else {
        console.error(`[WhatsApp:template] ERROR ${response.status} (code ${errorCode}): ${errorMessage}`)
      }

      return { ok: false, error: errorMessage, errorCode }
    }

    const messageId = responseBody.messages?.[0]?.id ?? undefined
    return { ok: true, messageId }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[WhatsApp:template] Error de red:', msg)
    return { ok: false, error: `Network error: ${msg}` }
  }
}

/**
 * Carga las credenciales de WhatsApp de una clínica desde la DB.
 * Retorna null si la clínica no tiene WhatsApp configurado.
 */
export async function getClinicCreds(clinicId: string): Promise<ClinicWhatsAppCredentials | null> {
  const { data } = await supabaseAdmin
    .from('clinics')
    .select('whatsapp_phone_id, whatsapp_access_token')
    .eq('id', clinicId)
    .maybeSingle()

  if (!data?.whatsapp_phone_id || !data?.whatsapp_access_token) return null

  return {
    phoneNumberId: data.whatsapp_phone_id as string,
    accessToken: data.whatsapp_access_token as string,
  }
}
