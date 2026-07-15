// ============================================================
// Notificación in-app de escalación de conversaciones.
// buildEscalationPayload es puro (testeable sin DB). El resto
// (notifyStaffOfEscalation / resolveEscalationNotifications) toca
// DB y se agrega en la Task 3.
// ============================================================

const MAX_BODY = 120

/** Trunca a MAX_BODY chars agregando "..." si se pasó. Puro. */
function truncate(s: string): string {
  const t = s.trim()
  return t.length > MAX_BODY ? t.slice(0, MAX_BODY) + '...' : t
}

/**
 * Construye el payload de una notif de escalación. Puro, sin DB.
 * NO incluye recipient — el fan-out lo hace notifyStaffOfEscalation.
 */
export function buildEscalationPayload(
  patientName: string | null,
  reason: string,
  conversationId: string,
): { type: 'conversation_escalated'; title: string; body: string; navigateTo: string } {
  const displayName = patientName?.trim() || 'Paciente nuevo'
  return {
    type: 'conversation_escalated',
    title: `${displayName} necesita atención`,
    body: truncate(reason),
    navigateTo: `/dashboard/conversations/${conversationId}`,
  }
}
