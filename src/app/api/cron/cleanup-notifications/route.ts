// ============================================================
// Cron: Cleanup old staff notifications (>30 days)
// Schedule: daily at 4am UTC (11pm COT)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/rate-limit'
import { clinicasVivas } from '@/lib/clinic/clinicas-vivas'

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Este cron BORRA. Antes lo hacía sobre la tabla entera, sin mirar de quién
  // era cada fila: un proceso destructivo que cruzaba inquilinos por omisión.
  const clinicas = await clinicasVivas('id')
  const clinicIds = clinicas.map((c) => c.id)
  console.log(`[Cron:CleanupNotifs] clínicas vivas: ${clinicIds.length}`)
  if (clinicIds.length === 0) {
    return NextResponse.json({ deleted: 0, icsPurged: 0, clinicas: 0 })
  }

  const { error, count } = await supabaseAdmin
    .from('staff_notifications')
    .delete({ count: 'exact' })
    .in('clinic_id', clinicIds)
    .lt('created_at', thirtyDaysAgo)
    // Las alertas de CRISIS nunca se borran por cron (registro de seguridad),
    // sin importar leída o antigüedad.
    .neq('type', 'crisis_detected')
    // Las solicitudes ARCO tampoco: son traza legal con término de respuesta.
    .neq('type', 'data_rights_request')
    // No borrar escalaciones NO resueltas: la alerta persiste hasta que
    // alguien atienda, sin importar la antigüedad. Se borran las notifs de
    // cita viejas y las escalaciones YA resueltas (read_at no nulo).
    .or('read_at.not.is.null,type.neq.conversation_escalated')

  if (error) {
    console.error('[Cron:CleanupNotifs] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[Cron:CleanupNotifs] Deleted ${count ?? 0} notifications older than 30 days`)

  // Purga de .ics hosteados de citas que YA pasaron. El archivo tiene nombre
  // de paciente + médico + hora → se borra cuando deja de ser útil. Post-purga,
  // el link /cita/{token} muestra la página amable (no el error de Supabase).
  // Solo toca el bucket calendar-invites (nunca dato clínico) — por eso NO va
  // en el cron de retención de documentos (que además está en dry-run).
  let icsPurged = 0
  try {
    const { data: pastWithICS } = await supabaseAdmin
      .from('appointments')
      .select('id, calendar_ics_path')
      .in('clinic_id', clinicIds)
      .not('calendar_ics_path', 'is', null)
      .lt('starts_at', new Date().toISOString())
      .limit(500)

    if (pastWithICS && pastWithICS.length > 0) {
      const paths = pastWithICS.map((a) => a.calendar_ics_path as string)
      const { error: rmErr } = await supabaseAdmin.storage.from('calendar-invites').remove(paths)
      if (rmErr) {
        console.error('[Cron:CleanupNotifs] ICS storage remove error:', rmErr.message)
      } else {
        // Limpiar la ruta solo si el borrado del objeto no falló (si no, reintenta mañana).
        await supabaseAdmin
          .from('appointments')
          .update({ calendar_ics_path: null })
          .in('id', pastWithICS.map((a) => a.id))
        icsPurged = paths.length
      }
    }
  } catch (e) {
    console.error('[Cron:CleanupNotifs] ICS purge failed:', e instanceof Error ? e.message : e)
  }
  console.log(`[Cron:CleanupNotifs] ICS purgados: ${icsPurged}`)

  return NextResponse.json({ ok: true, deleted: count ?? 0, ics_purged: icsPurged })
}
