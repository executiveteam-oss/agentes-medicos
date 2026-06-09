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

// Medido 2026-06-09 en Vercel: run real toma ~280s con 60 días + ~450 admisiones.
// Margen de 20s vs 300s es ajustado; subir a 600s da cushion para crecimiento de
// volumen sin tocar dias_adelante. Tope del plan Pro es 800s; 600s deja headroom.
export const maxDuration = 600

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
    action: 'test' | 'import' | 'force_sync' | 'delete'
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

  if (body.action === 'delete') {
    await supabaseAdmin.from('appointments').delete().eq('clinic_id', clinicId).eq('external_source', 'isalud')
    await supabaseAdmin.from('doctor_external_mappings').delete().eq('clinic_id', clinicId).eq('provider', 'isalud')
    await supabaseAdmin.from('sync_integrations').delete().eq('clinic_id', clinicId).eq('provider', 'isalud')
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Acción no válida' }, { status: 400 })
}
