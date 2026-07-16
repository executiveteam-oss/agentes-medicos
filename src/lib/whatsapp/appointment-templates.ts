// ============================================================
// Templates de WhatsApp para recordatorios y cancelación de citas.
//
// Estos textos DEBEN matchear EXACTAMENTE las plantillas aprobadas en el
// Meta Business Manager de cada clínica. En runtime NO se envía el body —
// se envían solo los PARÁMETROS ({{1}}..{{5}}) y Meta rellena la plantilla
// aprobada. Estas constantes son la fuente de verdad para: (a) el snapshot
// test que evita ediciones sin re-aprobar en Meta, (b) documentación.
//
// Regla Meta: una variable no puede ser el primer ni el último carácter del
// body. Por eso `recordatorio_cita` cierra con "Te esperamos." (sin esa
// línea, {{5}} quedaba último y Meta lo rechaza).
// ============================================================

export const TEMPLATE_LANGUAGE = 'es_CO'

// --- Recordatorio (72h / 24h / 2h — un solo template, cambia el "cuándo") ---
export const REMINDER_TEMPLATE_NAME = 'recordatorio_cita'
export const REMINDER_TEMPLATE_BODY =
  'Hola {{1}} 👋 Te recordamos tu cita con {{2}} el {{3}} a las {{4}}.\n📍 {{5}}\nTe esperamos.'
// Quick Reply buttons (texto estático, sin variables runtime)
export const REMINDER_BUTTONS = ['Confirmar', 'Reagendar', 'Cancelar'] as const

// --- Cancelación ---
export const CANCEL_TEMPLATE_NAME = 'cancelacion_cita'
export const CANCEL_TEMPLATE_BODY =
  'Hola {{1}} 👋 Lamentamos informarte que tu cita con {{2}} del {{3}} a las {{4}} fue cancelada {{5}}. Queremos reagendarte lo antes posible.'
export const CANCEL_BUTTON = 'Reagendar'
