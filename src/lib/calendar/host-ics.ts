// ============================================================
// Hosting de .ics en Storage privado + link a nuestra ruta /cita/{token}
//
// No mandamos el signed URL crudo al paciente: mandamos {APP_URL}/cita/{token},
// que al tocarlo genera un signed URL de 60s y redirige. Así:
//  - el link vive mientras exista el archivo (hasta que pasa la cita),
//  - vencido/purgado = página amable, nunca el error JSON de Supabase,
//  - el signed URL real solo dura 60s en manos del paciente.
//
// Reagendar/cancelar reusan la MISMA ruta (upsert): un archivo por cita,
// mismo UID → el calendario actualiza en su lugar; cualquier link viejo
// sirve el contenido actual.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'

const BUCKET = 'calendar-invites'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://omuwan.co'

/**
 * Sube (o reemplaza) el .ics de una cita y devuelve el link para el paciente.
 * Nunca tira: devuelve null si algo falla (el envío del .ics es no-crítico).
 * @returns `${APP_URL}/cita/{token}` o null si falló el upload.
 */
export async function hostICSAndGetLink(params: {
  appointmentId: string
  icsContent: string
}): Promise<string | null> {
  const { appointmentId, icsContent } = params
  try {
    // Reusar la ruta existente (reagendar/cancelar) o crear una nueva.
    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('calendar_ics_path')
      .eq('id', appointmentId)
      .maybeSingle()

    const path = apt?.calendar_ics_path || `${crypto.randomUUID()}.ics`
    const token = path.replace(/\.ics$/, '')

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, Buffer.from(icsContent, 'utf-8'), {
        // text/calendar explícito: iOS necesita este content-type para rutear
        // al Calendario. Sin él lo abre como texto (el mismo bug del adjunto).
        contentType: 'text/calendar',
        upsert: true,
      })
    if (upErr) {
      console.error('[host-ics] upload failed:', upErr.message)
      return null
    }

    // Persistir la ruta solo la primera vez (reagendar ya la tenía).
    if (!apt?.calendar_ics_path) {
      await supabaseAdmin
        .from('appointments')
        .update({ calendar_ics_path: path })
        .eq('id', appointmentId)
    }

    return `${APP_URL}/cita/${token}`
  } catch (err) {
    console.error('[host-ics] error:', err instanceof Error ? err.message : err)
    return null
  }
}
