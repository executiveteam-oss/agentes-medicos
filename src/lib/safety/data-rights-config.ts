// ============================================================
// Capa 0 — acuse de solicitudes sobre datos personales (ARCO / habeas data).
// El bot NUNCA cumple la solicitud (no borra, no exporta, no rectifica): solo
// acusa recibo, escala y avisa al staff, que responde dentro del término legal.
//
// Wording APROBADO por Algia (2026-08-03). {clinic} interpola el nombre de la
// clínica (multi-tenant). "15 días hábiles" ES el término del reclamo bajo Ley
// 1581 — aprobado explícito, no contradice la política vigente.
// ============================================================

const DATA_RIGHTS_ACK_TEMPLATE =
  'Recibí tu solicitud sobre tus datos personales y ya quedó registrada.\n\n' +
  '{clinic} tiene hasta 15 días hábiles para darte una respuesta formal, y una persona del equipo se va a comunicar contigo para confirmarte cómo va.\n\n' +
  "Si quieres consultar la política de tratamiento de datos, escribe 'privacidad' y te comparto el enlace."

/** Acuse al paciente al detectar una solicitud ARCO. Puro. */
export function buildDataRightsAck(clinicName: string | null): string {
  return DATA_RIGHTS_ACK_TEMPLATE.replace('{clinic}', clinicName?.trim() || 'el consultorio')
}
