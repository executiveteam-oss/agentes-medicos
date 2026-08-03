// ============================================================
// Config de crisis (por-clínica, en clinics.whatsapp_config.crisis).
// El wording de contención es BORRADOR pendiente de validación clínica de
// Algia (spec §8). El default 106+123 es piso para tests, no texto final.
// ============================================================
import { z } from 'zod'

export const crisisConfigSchema = z.object({
  detection_enabled: z.boolean(),
  auto_message_approved: z.boolean(),
  containment_message: z.string().min(1),
  human_handoff_message: z.string().min(1),
})

export type CrisisConfig = z.infer<typeof crisisConfigSchema>

export const DEFAULT_CRISIS_CONFIG: CrisisConfig = {
  detection_enabled: true,       // detectar + escalar + alertar SIEMPRE
  auto_message_approved: false,  // NO enviar contención hasta validación clínica de Algia
  containment_message:
    'Lamento mucho que estés pasando por esto, y me importa. No estás solo/a. ' +
    'Por favor comunícate ahora con la Línea 106 (salud mental, gratuita, 24/7) ' +
    'o llama al 123 si estás en peligro inmediato. Una persona del consultorio ' +
    'va a contactarte lo antes posible. 🙏',
  human_handoff_message:
    'Con gusto te paso con una persona del consultorio. Ya te contactan. 🙏',
}

/** Construye el mensaje de contención. Interpola {nombre} si viene.
 *  Colapsa SOLO espacios/tabs repetidos (limpieza tras interpolar {nombre}),
 *  NUNCA saltos de línea: el wording de crisis viene en párrafos separados y
 *  debe llegar EXACTO (WhatsApp respeta \n). Un `\s{2,}` colapsaría los \n\n. */
export function buildContainmentMessage(config: CrisisConfig, patientFirstName?: string): string {
  const nombre = (patientFirstName ?? '').trim().split(' ')[0] || ''
  return config.containment_message.replace(/\{nombre\}/g, nombre).replace(/[^\S\n]{2,}/g, ' ').trim()
}
