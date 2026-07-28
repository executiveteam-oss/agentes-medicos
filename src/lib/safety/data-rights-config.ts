// ============================================================
// Capa 0 — acuse de solicitudes sobre datos personales (ARCO / habeas data).
// El bot NUNCA cumple la solicitud (no borra, no exporta, no rectifica): solo
// acusa recibo, escala y avisa al staff, que responde dentro del término legal.
//
// Wording BORRADOR — pendiente de validación de Algia. Usa "término legal" a
// propósito (NO hardcodea 15 días): 15 días hábiles ES el término del reclamo
// bajo Ley 1581, así no contradice la política vigente de la clínica y sirve
// multi-tenant.
// ============================================================

const DATA_RIGHTS_ACK_TEMPLATE =
  'Recibí tu mensaje sobre el manejo de tus datos personales. ' +
  'Lo registré y el equipo de {clinic} lo va a revisar y responderte dentro del término legal. ' +
  'Una persona te contacta por este mismo medio. 🔐'

/** Acuse al paciente al detectar una solicitud ARCO. Puro. */
export function buildDataRightsAck(clinicName: string | null): string {
  return DATA_RIGHTS_ACK_TEMPLATE.replace('{clinic}', clinicName?.trim() || 'el consultorio')
}
