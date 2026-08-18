// ============================================================
// ¿Se le puede mandar TEXTO LIBRE a esta paciente?
//
// Meta sólo lo permite dentro de las 24h desde su último mensaje. Fuera de esa
// ventana hay que usar una plantilla aprobada.
//
// Fuente ÚNICA de esa pregunta (patrón 2 del CLAUDE.md): vivía privada dentro
// de `contactar-paciente.ts`, y cuando el aviso de "tu cita se movió" necesitó
// lo mismo, la opción era copiarla. Dos implementaciones de "¿está abierta la
// ventana?" divergen en silencio, y el síntoma sería un envío rechazado por
// Meta que nadie relaciona con esto.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

export const VENTANA_MS = 24 * 60 * 60 * 1000

/** True si la paciente escribió hace menos de 24h en esa conversación. */
export async function ventanaAbierta(conversationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('role', 'patient')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.created_at) return false
  return Date.now() - new Date(data.created_at as string).getTime() < VENTANA_MS
}
