// ============================================================
// API Route — iSalud Sync (Playwright in Vercel Pro)
// GET: Vercel Cron — sync all integrations
// POST: import / force_sync / test from dashboard
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/rate-limit'
import { getUserSession } from '@/lib/session'
import { importISalud, syncAllISaludIntegrations } from '@/lib/isalud/sync-agent'
import { testISaludConnection } from '@/lib/isalud/adapter'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 300

// GET — Cron
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  console.log('[iSalud Cron] Starting sync...')
  const result = await syncAllISaludIntegrations()
  console.log(`[iSalud Cron] Done: ${result.synced} synced, ${result.errors.length} errors`)
  return NextResponse.json({ status: 'ok', ...result })
}

// POST — Dashboard actions
export async function POST(request: NextRequest) {
  const session = await getUserSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json() as {
    action: 'test' | 'import' | 'force_sync'
    credentials?: { subdomain: string; username: string; password: string }
  }

  const clinicId = session.clinicId

  if (body.action === 'test') {
    if (!body.credentials) return NextResponse.json({ error: 'Credenciales requeridas' }, { status: 400 })
    return NextResponse.json(await testISaludConnection(body.credentials))
  }

  if (body.action === 'import') {
    if (!body.credentials) return NextResponse.json({ error: 'Credenciales requeridas' }, { status: 400 })
    return NextResponse.json(await importISalud(body.credentials, clinicId))
  }

  if (body.action === 'force_sync') {
    const { data: integration } = await supabaseAdmin
      .from('sync_integrations')
      .select('id, clinic_id, credentials, config')
      .eq('clinic_id', clinicId).eq('provider', 'isalud').maybeSingle()

    if (!integration) return NextResponse.json({ error: 'No hay integración iSalud configurada' }, { status: 404 })

    const creds = (integration as { credentials: Record<string, unknown> }).credentials
    const result = await importISalud(
      { subdomain: creds.subdomain as string, username: creds.username as string, password: creds.password as string },
      clinicId
    )
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: 'Acción no válida' }, { status: 400 })
}
