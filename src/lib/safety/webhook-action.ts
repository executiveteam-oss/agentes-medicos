// ============================================================
// Precedencia DETERMINISTA del webhook. Fuente única del orden de decisión.
// Capa 0 (los 5 detectores) SIEMPRE corre antes que la desambiguación de
// identidad: una crisis, pedido de humano o derecho ARCO desde un teléfono
// compartido tiene que ESCALAR, nunca recibir "confirma tu documento".
// Orden: crisis > ARCO > consulta política > servicio ruleado > humano >
//        desambiguación > agente.
// ============================================================
import { detectCrisis, detectHumanRequest, detectDataRightsRequest, detectPrivacyPolicyQuery } from './crisis-patterns'
import { detectEscalateService } from './escalate-service-matcher'

export type WebhookAction =
  | 'crisis'
  | 'data_rights'
  | 'privacy_query'
  | 'escalate_service'
  | 'human_request'
  | 'disambiguate'
  | 'proceed'

/**
 * Decide qué etapa maneja el mensaje, en orden de precedencia fijo.
 * `phoneAmbiguous` = el teléfono matchea 2+ pacientes y aún no se resolvió quién es.
 * La desambiguación es lo ÚLTIMO antes de proceder al agente: solo se llega a ella
 * si ninguno de los 5 detectores de Capa 0 disparó.
 */
export function decideWebhookAction(input: {
  text: string
  crisisEnabled: boolean
  phoneAmbiguous: boolean
}): WebhookAction {
  const { text, crisisEnabled, phoneAmbiguous } = input
  if (crisisEnabled && detectCrisis(text).matched) return 'crisis'
  if (detectDataRightsRequest(text).matched) return 'data_rights'
  if (detectPrivacyPolicyQuery(text).matched) return 'privacy_query'
  if (detectEscalateService(text).matched) return 'escalate_service'
  if (crisisEnabled && detectHumanRequest(text).matched) return 'human_request'
  if (phoneAmbiguous) return 'disambiguate'
  return 'proceed'
}
