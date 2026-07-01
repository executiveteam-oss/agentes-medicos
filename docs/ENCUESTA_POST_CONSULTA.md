# Encuesta post-consulta

> Feature configurable en Omuwan. Envía un link a tu formulario de satisfacción
> por WhatsApp cuando una cita queda facturada. Se disparó una encuesta = pediste
> feedback a esa paciente automáticamente, sin que nadie del staff se acuerde.

## Cómo funciona

1. Cuando el sistema detecta que una cita quedó marcada como **Facturada** (esto ocurre por sync de iSalud al cierre de jornada), se agrega a la cola de encuestas pendientes.
2. Cada hora, el sistema procesa la cola y envía la plantilla de WhatsApp a cada paciente.
3. La paciente recibe un mensaje corto + un botón "Responder encuesta" que abre tu formulario.
4. Se registra que ya se envió para no re-enviar.

## Cómo activarla

### 1. Meta Business Manager — crear y aprobar la plantilla

Como cada clínica opera su propio Meta Business, la plantilla se aprueba **una vez por clínica**. Es un trámite corto (~15 min) + tiempo de aprobación de Meta (24-72h).

Andá a **Configuración → Automatizaciones → Encuesta post-consulta** y expandí el panel "Cómo aprobar la plantilla en Meta Business Manager". La guía tiene el texto exacto para pegar en Meta con botones de copiar.

Datos clave:
- **Category**: UTILITY
- **Name**: `encuesta_satisfaccion`
- **Language**: Spanish (COL)
- **Body** (texto fijo con variables `{{1}}` y `{{2}}`):
  > Buen día {{1}}. Sería tan amable de diligenciar la encuesta de satisfacción de {{2}}. Gracias por ayudarnos a mejorar nuestra atención.
- **Button**: URL dinámica ("Visit Website" con Dynamic URL `{{1}}`), texto: "Responder encuesta"

### 2. Configurar en Omuwan

En la misma pantalla, completá:
- **URL del formulario**: el link HTTPS de tu Google Form (o Typeform, o cualquier form)
- **Nombre de la clínica en el mensaje**: cómo querés que aparezca tu clínica en el mensaje. Si lo dejás vacío, usamos el nombre de la clínica configurado en la sección Consultorio.
- **Nombre del template en Meta**: dejá `encuesta_satisfaccion` a menos que aprobaste con otro nombre.

### 3. Activar

Cuando Meta apruebe la plantilla, prendé el toggle de arriba. Desde ahí en adelante, cada cita facturada dispara una encuesta.

## Configuración avanzada

- **Guardrail (horas)**: solo enviar si la cita fue hace menos de N horas. Default 48h. Cubre el caso normal (Lady factura al cierre = 6 PM, cita 9 AM = 9h atrás) más un día de gracia si el cron cayó. Sin este guardrail, si el cron cae 3 días y se recupera, mandaría encuestas de citas viejas.

## Vista previa

La pantalla de configuración muestra un preview del mensaje con tus valores actuales, así ves qué le llega a la paciente antes de activar.

## Qué NO hace

- **NO procesa la respuesta**. Si la paciente responde el WhatsApp con texto, no lo captura. Toda la respuesta va al formulario (Google Sheets / Typeform / etc).
- **NO envía a citas canceladas ni no-shows**. Solo dispara con `attendance_outcome = 'facturado'`.
- **NO reenvía**. Cada cita recibe la encuesta como máximo una vez.

## Requisitos técnicos

- WhatsApp Business conectado a Omuwan
- El feature debe estar habilitado por Omuwan para tu clínica (contactá soporte@omuwan.co si no lo ves activable)

## Troubleshooting

| Problema | Causa probable | Solución |
|---|---|---|
| No se envían encuestas | Toggle en OFF | Revisá que esté activo |
| No se envían encuestas | `form_url` vacío | Configurá la URL del formulario |
| El mensaje llega con texto viejo | Meta no re-cargó la plantilla actualizada | Meta puede tardar 1-2h en propagar cambios; esperar |
| Meta rechazó la plantilla | Categoría MARKETING en vez de UTILITY | Volvé a someter con UTILITY |
| Meta rechazó la plantilla | Sample de URL inválida | Usá una URL real de tu form como sample |
| Encuesta llegó a una paciente que no debía recibirla | La cita quedó marcada Facturada por error | Revertí el estado de la cita; no se re-envía porque ya está el flag `survey_sent=true` |

Para cualquier caso no listado, escribí a soporte@omuwan.co con el ID de la cita.
