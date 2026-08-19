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

// --- ⚰️ Recordatorio V1 — MUERTO. No lo usa nadie y NO existe en Meta. ---
//
// El switch a la V2 ya ocurrió: el cron importa REMINDER_TEMPLATE_NAME_V2 en
// las tres ventanas (72h/24h/2h) y `recordatorio_cita` NO figura en la cuenta
// de WhatsApp de Algia — se verificó el 2026-08-19 listando las 8 plantillas
// aprobadas del WABA. Mandarlo sería un envío rechazado.
//
// El comentario de abajo decía que la V1 "queda como fallback y se switchea
// cuando Meta apruebe la V2", que es exactamente al revés de la realidad. Se
// deja la constante sólo para que el snapshot siga congelando el wording de la
// plantilla que alguna vez estuvo aprobada; NO usarla para enviar.
export const REMINDER_TEMPLATE_NAME = 'recordatorio_cita'
export const REMINDER_TEMPLATE_BODY =
  'Hola {{1}} 👋 Te recordamos tu cita con {{2}} el {{3}} a las {{4}}.\n📍 {{5}}\nTe esperamos.'

// Quick Reply de los recordatorios. Vive acá arriba por historia, pero son los
// botones de la V2 —la que se manda— y los procesa handleReminderResponse.
export const REMINDER_BUTTONS = ['Confirmar', 'Reagendar', 'Cancelar'] as const

// --- ✅ Recordatorio V2 — la que se usa (APPROVED) ---
// Identifica a la clínica en la 1ª línea: con un número nuevo sin reputación, la
// paciente que NO lo guardó ve sólo el TELÉFONO, no el display name (salvo
// Official Business Account). Por eso {{2}} es la clínica.
// Params: {{1}} paciente, {{2}} clínica, {{3}} médico, {{4}} fecha,
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

// --- Solicitud de ORDEN MÉDICA externa (post-consulta) ---
// La clínica necesita la orden para radicar la cuenta con la entidad, y a veces
// la paciente ya se fue sin dejarla. Es proactivo y casi siempre FUERA de la
// ventana de 24h, así que va por template.
// Sin botones: la respuesta esperada es un ARCHIVO, y un Quick Reply no manda
// archivos — un botón solo agregaría un camino muerto.
// "Sobre tu cita del ..." en pasado: la consulta YA ocurrió.
export const ORDEN_TEMPLATE_NAME = 'solicitud_orden_medica'
export const ORDEN_TEMPLATE_BODY =
  'Hola {{1}} 👋 Te escribimos de {{2}}. Sobre tu cita del {{3}} a las {{4}} necesitamos la orden médica de tu {{5}}.\n\nPuedes enviárnosla por aquí como foto o PDF. Sin ella no podemos radicar la cuenta con tu entidad.'

// --- Reagendamiento (la cita se MOVIÓ) ---
// Proactivo y casi siempre FUERA de la ventana de 24h, así que va por
// plantilla. Hasta que Meta apruebe ésta se usa `contacto_general`, donde todo
// el aviso entra en UN parámetro y le llega a la paciente en una sola línea
// corrida — fecha, hora, médico y link pegados. Es el mensaje que le avisa que
// su cita cambió de día: tiene que leerse bien.
//
// {{6}} lleva el motivo Y, si hace falta, el pedido de reconfirmar. Va junto
// porque una plantilla no tiene condicionales, y un parámetro vacío se rechaza.
// {{7}} es el link del .ics; cierra con "Te esperamos." para que la variable no
// quede última (Meta lo rechaza).
//
// SIN botón de Quick Reply a propósito: "Confirmar" acá no funcionaría —
// handleReminderResponse sólo encuentra citas con un recordatorio ya enviado, y
// mover la cita resetea justamente esos flags. Ella reconfirma con el
// recordatorio normal de la fecha nueva, que sí tiene el botón.
export const REAGENDA_TEMPLATE_NAME = 'reagendamiento_cita'
export const REAGENDA_TEMPLATE_BODY =
  'Hola {{1}} 👋 Te escribimos de {{2}}.\n\nTu cita con {{3}} quedó reprogramada para el {{4}} a las {{5}}.\n\n{{6}}\n\nSi la tenías guardada en tu calendario, acá la actualizas: {{7}}\n\nTe esperamos.'

// --- Contacto general (cualquier motivo, con o sin cita) ---
// El motivo va en su PROPIA línea después de dos puntos — misma lección que la
// cancelación: así funciona con cualquier redacción que escriba la secretaria.
// Meta lo categorizó UTILITY al someterlo (2026-08-09).
export const CONTACTO_TEMPLATE_NAME = 'contacto_general'
export const CONTACTO_TEMPLATE_BODY =
  'Hola {{1}} 👋 Te escribimos de {{2}}.\n\nQueremos comentarte algo sobre tu atención:\n{{3}}\n\n¿Nos respondes por aquí cuando puedas?'
