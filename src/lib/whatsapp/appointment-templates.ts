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

// --- Recordatorio V2: identifica a la clínica en la 1ª línea ---
// Número nuevo sin reputación: la paciente que NO guardó el número ve solo el
// TELÉFONO, no el display name (salvo Official Business Account). Por eso la 1ª
// línea nombra a la clínica ({{2}}). Es un template NUEVO (otro nombre) a
// propósito: editar `recordatorio_cita` lo manda a revisión de Meta y nos deja
// sin ninguno usable — el viejo queda como fallback y se switchea cuando Meta
// apruebe éste. Params: {{1}} paciente, {{2}} clínica, {{3}} médico, {{4}} fecha,
// {{5}} hora, {{6}} dirección.
export const REMINDER_TEMPLATE_NAME_V2 = 'recordatorio_cita_v2'
export const REMINDER_TEMPLATE_BODY_V2 =
  'Hola {{1}} 👋 Te escribimos de {{2}}. Te recordamos tu cita con {{3}} el {{4}} a las {{5}}.\n📍 {{6}}\nTe esperamos.'

// --- Cancelación ---
// El motivo va en su PROPIA oración. Antes era "fue cancelada {{5}}", y las
// secretarias escriben solo el motivo ("se enfermó", "tuvo un accidente"), así
// que salía "fue cancelada se enfermó". Con "Motivo: {{5}}." funciona con
// cualquier redacción. Es el mensaje que recibe una paciente a la que le
// cancelan: tiene que leerse profesional.
export const CANCEL_TEMPLATE_NAME = 'cancelacion_cita'
export const CANCEL_TEMPLATE_BODY =
  'Hola {{1}} 👋 Lamentamos informarte que tu cita con {{2}} del {{3}} a las {{4}} fue cancelada. Motivo: {{5}}. Queremos reagendarte lo antes posible.'
export const CANCEL_BUTTON = 'Reagendar'

// --- Resumen diario del médico (cron 6am, sin botones) ---
// {{2}} lleva cantidad + lista en UNA sola línea (ej. "4 citas — 8:00 AM Juana
// Pérez, 9:00 AM María López"). Sin saltos de línea (Meta rechaza newlines en
// params). El código pluraliza "1 cita" / "N citas" dentro de {{2}}.
export const RESUMEN_TEMPLATE_NAME = 'resumen_diario_medico'
export const RESUMEN_TEMPLATE_BODY =
  'Buenos días, {{1}} 👋 Estas son sus citas de hoy: {{2}}. Que tenga un buen día.'
