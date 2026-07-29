// ============================================================
// Motivos de rechazo de autorización — lógica pura (Bloque 4, slice chico).
//
// El motivo INTERNO (key + nota libre) NO se manda a la paciente. Cada motivo
// mapea a un texto AMABLE en tuteo colombiano (Algia es de Pereira). El texto
// va como mensaje libre si la ventana de 24h está abierta; si no, queda para
// el template (ver authorization-review.ts).
//
// NOTA: los mensajes son GENÉRICOS (no nombran el servicio). En el slice chico
// no hay tabla que ligue el documento a un servicio; nombrarlo requeriría el
// rediseño completo (authorization_requests). Ver spec 2026-07-27.
// ============================================================

export const REJECT_REASONS = [
  { key: 'vencida', label: 'Vencida' },
  { key: 'mal_direccionada', label: 'Mal direccionada a la clínica' },
  { key: 'ilegible', label: 'Ilegible' },
  { key: 'no_corresponde', label: 'No corresponde al servicio' },
  { key: 'otra', label: 'Otra (especificar)' },
] as const

export type RejectReasonKey = (typeof REJECT_REASONS)[number]['key']

export function isRejectReasonKey(k: string): k is RejectReasonKey {
  return REJECT_REASONS.some((r) => r.key === k)
}

/**
 * Texto AMABLE que se le envía a la paciente (tuteo colombiano).
 * Para 'otra' usa el texto libre que escribió la secretaria (ella redacta).
 * 'mal_direccionada' interpola el nombre de la clínica.
 */
export function buildRejectPatientMessage(
  key: RejectReasonKey,
  opts: { clinicName: string; freeText?: string },
): string {
  switch (key) {
    case 'vencida':
      return 'Revisamos tu autorización y está vencida. Pídele a tu EPS una vigente y reenvíamela por aquí.'
    case 'mal_direccionada':
      return `Revisamos tu autorización y debe estar direccionada a ${opts.clinicName}. Pídele a tu EPS que la corrija y reenvíala por aquí.`
    case 'ilegible':
      return 'Revisamos tu autorización pero no pudimos leerla bien. ¿Puedes reenviarla más clara (foto nítida o PDF)?'
    case 'no_corresponde':
      return 'Revisamos tu autorización y no corresponde al servicio que necesitas. Verifica con tu EPS y reenvía la correcta por aquí.'
    case 'otra':
      return (opts.freeText ?? '').trim()
  }
}
