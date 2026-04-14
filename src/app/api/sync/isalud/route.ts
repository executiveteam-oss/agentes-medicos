// ============================================================
// API Route — iSalud Sync
// GET: Vercel Cron (hourly) — sync all integrations
// POST: Manual import or force sync from dashboard
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/rate-limit'
import { getUserSession } from '@/lib/session'
import { importISalud, syncAllISaludIntegrations, syncOrganization } from '@/lib/isalud/sync-agent'
import { testISaludConnection } from '@/lib/isalud/adapter'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 300

// GET — Cron: sync all active iSalud integrations
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  console.log('[iSalud Cron] Starting sync...')
  const result = await syncAllISaludIntegrations()
  console.log(`[iSalud Cron] Done: ${result.synced} synced, ${result.errors.length} errors`)

  return NextResponse.json({ status: 'ok', ...result })
}

// POST — Manual actions from dashboard
export async function POST(request: NextRequest) {
  const session = await getUserSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const body = await request.json() as {
    action: 'test' | 'import' | 'force_sync'
    credentials?: { subdomain: string; email: string; password: string }
  }

  const clinicId = session.clinicId

  if (body.action === 'test') {
    if (!body.credentials) {
      return NextResponse.json({ error: 'Credenciales requeridas' }, { status: 400 })
    }
    const result = await testISaludConnection(body.credentials)
    return NextResponse.json(result)
  }

  if (body.action === 'import') {
    if (!body.credentials) {
      return NextResponse.json({ error: 'Credenciales requeridas' }, { status: 400 })
    }
    const result = await importISalud(body.credentials, clinicId)
    return NextResponse.json(result)
  }

  if (body.action === 'force_sync') {
    const { data: integration } = await supabaseAdmin
      .from('sync_integrations')
      .select('id, clinic_id, credentials, config')
      .eq('clinic_id', clinicId)
      .eq('provider', 'isalud')
      .maybeSingle()

    if (!integration) {
      return NextResponse.json({ error: 'No hay integración iSalud configurada' }, { status: 404 })
    }

    const report = await syncOrganization(integration as {
      id: string; clinic_id: string
      credentials: Record<string, unknown>
      config: { dias_adelante?: number }
    })
    return NextResponse.json(report)
  }

  return NextResponse.json({ error: 'Acción no válida' }, { status: 400 })
}
