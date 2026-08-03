// ============================================================
// Fricción de "devolver al agente" (Etapa 3). Regla PURA, testeable sin DB.
// Una conversación escalada por CRISIS exige un motivo para devolverla (el
// checkbox + textarea son UI; esto se valida TAMBIÉN server-side). Los demás
// motivos van con confirmación liviana (sin motivo obligatorio).
// ============================================================

/** true si falta el motivo obligatorio (crisis sin motivo) → la acción rechaza. */
export function crisisReturnMissingReason(
  escalationReason: string | null | undefined,
  reason: string | null | undefined,
): boolean {
  return escalationReason === 'crisis' && !(reason && reason.trim().length > 0)
}
