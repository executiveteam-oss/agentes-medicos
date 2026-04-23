// ============================================================
// Validadores Zod para payloads de WhatsApp
// Valida que lo que Meta envía al webhook tenga la forma correcta
// Si no pasa validación, ignoramos el mensaje (puede ser spam o error)
// ============================================================

import { z } from 'zod'

// Schema para validar el payload completo del webhook
export const whatsappWebhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.literal('whatsapp'),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            contacts: z
              .array(
                z.object({
                  profile: z.object({ name: z.string() }).optional(),
                  wa_id: z.string(),
                })
              )
              .optional(),
            messages: z
              .array(
                z.object({
                  from: z.string(),
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                })
              )
              .optional(),
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                  timestamp: z.string(),
                  recipient_id: z.string(),
                })
              )
              .optional(),
          }),
          field: z.literal('messages'),
        })
      ),
    })
  ),
})

// Tipo derivado del schema (para usar en el código)
export type ValidatedWebhookPayload = z.infer<typeof whatsappWebhookSchema>
