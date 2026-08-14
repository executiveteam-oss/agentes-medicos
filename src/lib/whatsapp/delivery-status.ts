// ============================================================
// ¿ESTE MENSAJE LLEGÓ? — fuente única.
//
// Meta manda por webhook el ciclo de vida de cada mensaje que enviamos:
//   sent → delivered → read     (o failed, con código)
//
// Hasta el 2026-08-14 el webhook los recibía y los tiraba. El caso que lo
// destapó: un resumen enviado a las 12:59 que Meta aceptó (`sent:1`, sin error)
// y nunca llegó al teléfono. El estado que lo explicaba entró NUEVE SEGUNDOS
// después y se descartó con un console.log.
//
// LA DISTINCIÓN QUE IMPORTA: "Meta aceptó el envío" (respuesta 200 del POST) no
// es "el mensaje llegó". Entre las dos hay una entrega asíncrona que puede
// fallar por template pausado, límite de categoría o rechazo del receptor — y
// de eso solo se entera uno por acá.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

/** Los estados que manda Meta. `failed` es el único que exige mirar el código. */
export const ESTADOS_ENTREGA = ['sent', 'delivered', 'read', 'failed'] as const
export type EstadoEntrega = (typeof ESTADOS_ENTREGA)[number]

/**
 * Orden del ciclo de vida. Se usa para no RETROCEDER un estado: los webhooks de
 * Meta no llegan garantizadamente en orden, y un `sent` que aterriza después de
 * un `delivered` no puede pisarlo — si no, un mensaje entregado se vería como
 * apenas enviado según qué webhook llegó último.
 *
 * `failed` es terminal y gana siempre: es la información accionable.
 */
const RANGO: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 99 }

export interface StatusEntrante {
  id: string
  status: string
  recipient_id?: string
  errors?: Array<{ code?: number; title?: string; message?: string }>
}

/**
 * Guarda (o actualiza) el estado de entrega de los mensajes de un webhook.
 *
 * No lanza: un fallo acá no puede tumbar el procesamiento del webhook, que
 * también trae mensajes de pacientes. Se loguea y sigue.
 *
 * @returns cuántos estados se registraron
 */
export async function registrarEstadosDeEntrega(
  statuses: StatusEntrante[],
  clinicId: string | null,
): Promise<number> {
  if (!statuses || statuses.length === 0) return 0
  let ok = 0

  for (const s of statuses) {
    try {
      const err = s.errors?.[0]
      const nuevo = s.status

      // No retroceder: si lo que ya está guardado es más avanzado, se ignora.
      const { data: previo } = await supabaseAdmin
        .from('whatsapp_message_status')
        .select('status')
        .eq('wamid', s.id)
        .maybeSingle()

      if (previo && (RANGO[previo.status as string] ?? 0) > (RANGO[nuevo] ?? 0)) continue

      await supabaseAdmin.from('whatsapp_message_status').upsert(
        {
          wamid: s.id,
          clinic_id: clinicId,
          status: nuevo,
          error_code: err?.code ?? null,
          error_title: err?.title ?? null,
          error_message: err?.message ?? null,
          // Solo los últimos 4 dígitos: el repo es público y el número completo
          // es dato personal (Ley 1581/2012).
          recipient_tail: s.recipient_id ? s.recipient_id.slice(-4) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'wamid' },
      )
      ok++

      if (nuevo === 'failed') {
        console.error(
          `[Webhook:status] ENTREGA FALLIDA ${s.id.slice(0, 20)}… → code ${err?.code ?? '?'}: ${err?.title ?? err?.message ?? 'sin detalle'}`,
        )
      }

      // Compatibilidad: los mensajes que SÍ tienen fila en `messages`
      // (conversaciones con pacientes) siguen actualizando su propia columna,
      // que es lo que lee el dashboard hoy.
      await supabaseAdmin
        .from('messages')
        .update({
          delivery_status: nuevo,
          ...(nuevo === 'failed' ? { delivery_error: err?.title ?? err?.message ?? 'failed' } : {}),
        })
        .eq('whatsapp_message_id', s.id)
    } catch (e) {
      console.error('[Webhook:status] No se pudo registrar el estado:', e)
    }
  }

  return ok
}
