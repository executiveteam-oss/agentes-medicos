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

  if (error) {
    console.error('[Cron:CleanupNotifs] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[Cron:CleanupNotifs] Deleted ${count ?? 0} notifications older than 30 days`)
  return NextResponse.json({ ok: true, deleted: count ?? 0 })
}
