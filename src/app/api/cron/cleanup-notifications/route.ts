// ============================================================
// Cron: Cleanup old staff notifications (>30 days)
// Schedule: daily at 4am UTC (11pm COT)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { error, count } = await supabaseAdmin
    .from('staff_notifications')
    .delete({ count: 'exact' })
    .lt('created_at', thirtyDaysAgo)
    // Las alertas de CRISIS nunca se borran por cron (registro de seguridad),
    // sin importar leída o antigüedad.
    .neq('type', 'crisis_detected')
    // No borrar escalaciones NO resueltas: la alerta persiste hasta que
    // alguien atienda, sin importar la antigüedad. Se borran las notifs de
    // cita viejas y las escalaciones YA resueltas (read_at no nulo).
    .or('read_at.not.is.null,type.neq.conversation_escalated')

  if (error) {
    console.error('[Cron:CleanupNotifs] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[Cron:CleanupNotifs] Deleted ${count ?? 0} notifications older than 30 days`)
  return NextResponse.json({ ok: true, deleted: count ?? 0 })
}
