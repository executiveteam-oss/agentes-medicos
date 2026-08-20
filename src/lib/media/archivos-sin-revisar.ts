// ============================================================
// UNA SOLA RESPUESTA A "¿QUÉ ARCHIVOS ESPERAN REVISIÓN?"
//
// El criterio es uno y es simple: `reviewed_at IS NULL`. Punto. Si hay un
// archivo sin revisar, existe para todo el sistema.
//
// Por qué está escrito así de tajante: la tarjeta del dashboard tenía su PROPIA
// consulta, con un filtro de más — `context = 'authorization'`. Ese contexto se
// asigna por heurística (si el último mensaje del agente decía la palabra
// "autorización"), así que en la práctica NO SE ASIGNÓ NUNCA: los 5 archivos de
// la historia de la clínica son 'document_general'. La tarjeta contaba cero
// desde el día que se construyó, mientras la pantalla mostraba los archivos ahí
// adentro. Una secretaria que confiaba en la tarjeta no entraba a mirarlos.
//
// El conteo de la tarjeta ya NO es una consulta paralela: es `.length` de esta
// misma lista. No pueden divergir porque son la misma llamada.
//
// Vive en `lib` y no en el archivo de actions a propósito: en un módulo
// 'use server' cada export es un endpoint público, y la tarjeta necesita
// llamarlo durante el render de un server component. Acá es una función común
// que importan los dos lados.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

export interface PendingAuthorization {
  media_id: string
  conversation_id: string
  patient_id: string | null
  patient_phone: string
  patient_name: string | null
  whatsapp_media_id: string | null
  mime_type: string | null
  filename: string | null
  size_bytes: number | null
  created_at: string
  conversation_escalation_reason: string | null
  context: string | null   // 'authorization' | 'document_general' | 'other' | null
}

/**
 * Todos los archivos que la clínica todavía no revisó, del más viejo al más
 * nuevo (FIFO). El `context` viaja en cada item para etiquetarlo en la UI —
 * pero NO decide si el archivo aparece.
 */
export async function traerArchivosSinRevisar(clinicId: string): Promise<PendingAuthorization[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_media')
    .select(`
      id,
      conversation_id,
      context,
      whatsapp_media_id,
      mime_type,
      filename,
      size_bytes,
      created_at,
      conversations:conversation_id (
        whatsapp_phone,
        context,
        patients:patient_id ( id, name )
      )
    `)
    .eq('clinic_id', clinicId)
    .is('reviewed_at', null)
    // El ÚLTIMO que llegó, arriba — como cualquier bandeja de mensajes.
    // Estaba al revés y la secretaria abría primero el archivo más viejo, que
    // es justo el que ya perdió actualidad: lo que acaba de llegar es lo que
    // tiene una paciente esperando del otro lado ahora mismo.
    .order('created_at', { ascending: false })

  if (error) throw new Error('Error consultando archivos recibidos')

  type ConvRow = {
    whatsapp_phone: string
    context: Record<string, unknown> | null
    patients?: { id: string; name: string } | { id: string; name: string }[] | null
  }

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string
      conversation_id: string
      context: string | null
      whatsapp_media_id: string | null
      mime_type: string | null
      filename: string | null
      size_bytes: number | null
      created_at: string
      conversations: ConvRow | ConvRow[] | null
    }
    const conv = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations
    const patient = conv?.patients
      ? (Array.isArray(conv.patients) ? conv.patients[0] : conv.patients)
      : null
    return {
      media_id: r.id,
      conversation_id: r.conversation_id,
      patient_id: patient?.id ?? null,
      patient_phone: conv?.whatsapp_phone ?? '',
      patient_name: patient?.name ?? null,
      whatsapp_media_id: r.whatsapp_media_id,
      mime_type: r.mime_type,
      filename: r.filename,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
      conversation_escalation_reason:
        (conv?.context as Record<string, unknown> | null)?.escalation_reason as string | null ?? null,
      context: r.context,
    }
  })
}

/**
 * Cuántos esperan revisión. Es `.length` de la lista de arriba, no una consulta
 * propia — traer las filas para contarlas cuesta más que un `count()`, y es a
 * propósito: con estos volúmenes no se nota, y el día que se note será una
 * decisión visible y no una divergencia silenciosa.
 */
export async function contarArchivosSinRevisar(clinicId: string): Promise<number> {
  return (await traerArchivosSinRevisar(clinicId)).length
}
