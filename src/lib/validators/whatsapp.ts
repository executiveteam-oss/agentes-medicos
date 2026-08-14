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
                  image: z.object({
                    id: z.string(),
                    mime_type: z.string().optional(),
                    sha256: z.string().optional(),
                    caption: z.string().optional(),
                  }).optional(),
                  document: z.object({
                    id: z.string(),
                    mime_type: z.string().optional(),
                    sha256: z.string().optional(),
                    filename: z.string().optional(),
                    caption: z.string().optional(),
                  }).optional(),
                  // Respuesta a botón Quick Reply de un template (ej. recordatorio_cita):
                  // Meta envía type:'button' con { text, payload } = texto del botón
                  // ("Confirmar"/"Reagendar"/"Cancelar"). Sin esto, Zod lo descarta.
                  button: z.object({
                    text: z.string().optional(),
                    payload: z.string().optional(),
                  }).optional(),
                })
              )
              .optional(),
            // Estado de entrega de los mensajes que mandamos NOSOTROS.
            // El schema ya los aceptaba; lo que faltaba era `errors`, que es
            // donde Meta dice POR QUÉ un mensaje no se entregó (132015 template
            // pausado, 131030 destinatario no permitido, etc.). Sin ese campo,
            // un `failed` llegaba sin motivo.
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                  // Opcionales a propósito: si Meta agrega o omite un campo, el
                  // safeParse falla y se descarta el webhook ENTERO — incluidos
                  // los mensajes de pacientes que vengan en el mismo payload.
                  timestamp: z.string().optional(),
                  recipient_id: z.string().optional(),
                  errors: z
                    .array(
                      z.object({
                        code: z.number().optional(),
                        title: z.string().optional(),
                        message: z.string().optional(),
                        error_data: z.object({ details: z.string().optional() }).optional(),
                      })
                    )
                    .optional(),
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
