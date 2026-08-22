// ============================================================
// ¿HAY UNA PERSONA ADENTRO DE ESTA CONVERSACIÓN?
//
// Una sola pregunta, una sola función (patrón 2). La contestan DOS consumidores
// que hasta el 2026-08-22 la resolvían por su cuenta y ya divergían:
//
//   · la bandeja (dashboard/conversations/page.tsx → `respondida_por_humano`),
//     que decide si una conversación escalada aparece en Atención;
//   · el corte por escalada del webhook, que decide si el agente se calla.
//
// La divergencia era medible: sobre las 72 escaladas de Algia, 16 tenían algún
// mensaje de staff pero sólo 7 lo tenían DESPUÉS de escalar. Las otras 9 la
// pantalla las mostraba como "nadie respondió" mientras el corte las trataba
// como atendidas — y por eso quedaban en silencio. El sistema no puede pensar
// distinto de lo que muestra.
//
// EL CRITERIO, y por qué es POSTERIOR a `escalated_at`: un mensaje del staff
// anterior a la escalación es historia, no intervención en curso. Que alguien
// le haya contestado la semana pasada no significa que esté atendiendo el
// problema por el que la conversación escaló hoy.
//
// Sin `escalated_at` (nulo) cualquier mensaje de staff cuenta: no hay contra
// qué comparar, y el sesgo seguro ahí es asumir que hay alguien adentro.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

/** Lo mínimo que hace falta de un mensaje para responder la pregunta. */
export interface MensajeParaIntervencion {
  role: string
  created_at: string
}

/**
 * La función. Pura: se testea sin DB y la usan los dos consumidores.
 */
export function huboIntervencionHumana(
  mensajes: ReadonlyArray<MensajeParaIntervencion> | null | undefined,
  escalatedAt: string | null | undefined,
): boolean {
  const corte = escalatedAt ? new Date(escalatedAt).getTime() : null
  return (mensajes ?? []).some(
    (m) => m.role === 'staff' && (corte === null || new Date(m.created_at).getTime() > corte),
  )
}

/**
 * La misma pregunta desde el server, cuando no se tienen los mensajes a mano
 * (el webhook). NO reimplementa el criterio: trae los mensajes de staff —que
 * son pocos, cero en la mayoría de las conversaciones— y llama a la función de
 * arriba. Una implementación, dos puertas de entrada.
 *
 * Ante un error de la query devuelve `true`: "hay alguien adentro" es el
 * resultado que produce silencio, y el silencio es el default seguro cuando no
 * sabemos.
 */
export async function consultarIntervencionHumana(
  conversationId: string,
  escalatedAt: string | null | undefined,
): Promise<{ hubo: boolean; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('role, created_at')
    .eq('conversation_id', conversationId)
    .eq('role', 'staff')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return { hubo: true, error: error.message }
  return { hubo: huboIntervencionHumana(data as MensajeParaIntervencion[], escalatedAt), error: null }
}
