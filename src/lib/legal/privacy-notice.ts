// ============================================================
// Aviso de privacidad — FUENTE ÚNICA DE VERDAD.
//
// Antes había 3 copias divergentes: la que enviaba el webhook (handleNewPatient),
// una en el system prompt (referencia), y una TERCERA en la pantalla de config
// legal que decía algo DISTINTO — quien lo aprobaba mirando ahí firmaba el texto
// equivocado. Ahora tanto el envío como la pantalla leen de acá → cero drift.
// ============================================================

/** Aviso que el sistema envía en el primer contacto con un paciente nuevo. */
export function buildPrivacyNotice(clinicName: string): string {
  return (
    `📋 Antes de continuar, te informo que ${clinicName} tratará tus datos personales ` +
    `según la Ley 1581 de 2012. Al continuar esta conversación, autorizas el tratamiento ` +
    `de tus datos para agendar y gestionar tus citas. Si nos envías documentos ` +
    `(autorizaciones, órdenes médicas), los recibimos y almacenamos de forma segura para ` +
    `gestionar tu atención, y los conservamos hasta 2 años. Si deseas conocer nuestra ` +
    `política completa o ejercer tus derechos, escribe "privacidad".`
  )
}
