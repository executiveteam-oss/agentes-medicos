// ============================================================
// FUENTE ÚNICA del whatsapp_config por defecto de una clínica nueva.
//
// Antes había 3 copias divergentes de escalation_keywords:
//   1. src/app/actions/whatsapp.ts (DEFAULT_CONFIG) — lista vieja
//   2. src/app/api/webhooks/whatsapp/route.ts (fallback) — lista arreglada, distinta
//   3. supabase/migrations/00012 (DEFAULT de columna) — lista vieja
// Alguien arregló la (2) y nunca propagó a (1)/(3). Resultado: "médico" y
// "hablar con alguien" seguían escalando en las clínicas sembradas. Esta es
// la ÚNICA fuente para el código; ver auth.ts (creación) que la setea explícito
// para que una clínica nueva NO herede el default de columna viejo.
//
// escalation_keywords: SOLO banderas clínicas. El pedido-de-humano NO va acá
// ("hablar con alguien", "humano", "persona real") — lo cubre Capa 0
// (detectHumanRequest), por palabra completa y sin duplicar. Las palabras
// sueltas (dolor, urgencia, emergencia, sangrado) quedan PENDIENTES de
// reemplazo por frases multi-palabra validadas por un médico (falso positivo:
// "dolor" es la razón de consulta modal en una clínica de dolor pélvico).
// ============================================================
import type { WhatsAppConfig } from '@/types/database'

export const DEFAULT_ESCALATION_KEYWORDS = ['urgencia', 'dolor', 'emergencia', 'sangrado']

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  schedule: {
    start: '07:00',
    end: '20:00',
    days: [1, 2, 3, 4, 5, 6],
    out_of_hours_message: 'Hola, nuestro horario de atención es de 7am a 8pm. Te responderemos mañana.',
  },
  appointment: {
    default_duration: 30,
    max_duration: 60,
  },
  escalation_keywords: DEFAULT_ESCALATION_KEYWORDS,
  doctors: {},
  automations: {
    post_consulta: { enabled: false },
    reactivacion: { enabled: false, days_inactive: 90 },
  },
}
