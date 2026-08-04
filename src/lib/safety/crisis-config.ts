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
    'Lamento mucho que estés pasando por esto. No tienes que enfrentarlo sin ayuda.\n\n' +
    'Ahora mismo tienes a quién acudir, sin esperar a nadie:\n' +
    '📞 Si estás en peligro inmediato, llama al 123.\n' +
    '💚 Para hablar ya, la Línea 106 es gratuita y atiende a cualquier hora. ' +
    'También puedes marcar al 606 333 9610.\n\n' +
    'El equipo del consultorio verá tu mensaje y te acompañará dentro de su horario de atención. ' +
    'Por favor no esperes por eso: el 123 y la 106 están disponibles ahora mismo. 🙏',
  human_handoff_message:
    'Con gusto le dejo tu mensaje al equipo del consultorio. Te responden dentro de su horario de atención. 🙏',
}

/** Construye el mensaje de contención. Interpola {nombre} si viene.
 *  Colapsa SOLO espacios/tabs repetidos (limpieza tras interpolar {nombre}),
 *  NUNCA saltos de línea: el wording de crisis viene en párrafos separados y
 *  debe llegar EXACTO (WhatsApp respeta \n). Un `\s{2,}` colapsaría los \n\n. */
export function buildContainmentMessage(config: CrisisConfig, patientFirstName?: string): string {
  const nombre = (patientFirstName ?? '').trim().split(' ')[0] || ''
  return config.containment_message.replace(/\{nombre\}/g, nombre).replace(/[^\S\n]{2,}/g, ' ').trim()
}
