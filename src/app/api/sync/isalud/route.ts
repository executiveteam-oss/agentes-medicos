// ============================================================
// API Route — iSalud Sync
// POST: save credentials / trigger GitHub Actions / diagnose
// GET: removed — cron runs via GitHub Actions now
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getUserSession } from '@/lib/session'
import { saveISaludCredentials, triggerGitHubSync } from '@/lib/isalud/sync-agent'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  const session = await getUserSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const body = await request.json() as {
    action: 'save_credentials' | 'force_sync'
    credentials?: { subdomain: string; username: string; password: string }
  }

  const clinicId = session.clinicId

  if (body.action === 'save_credentials') {
    if (!body.credentials) {
      return NextResponse.json({ error: 'Credenciales requeridas' }, { status: 400 })
    }

    await saveISaludCredentials(clinicId, body.credentials)

    // Trigger immediate sync via GitHub Actions
    const dispatch = await triggerGitHubSync()

    return NextResponse.json({
      ok: true,
      sync_triggered: dispatch.ok,
      message: dispatch.ok
        ? 'Credenciales guardadas. Sincronización iniciada — los resultados llegarán en unos minutos.'
        : 'Credenciales guardadas. Configura GITHUB_DISPATCH_TOKEN para sincronización automática.',
    })
  }

  if (body.action === 'force_sync') {
    const dispatch = await triggerGitHubSync()
    if (!dispatch.ok) {
      return NextResponse.json({ error: dispatch.error ?? 'No se pudo iniciar sync' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, message: 'Sincronización iniciada — los resultados llegarán en unos minutos.' })
  }

  return NextResponse.json({ error: 'Acción no válida' }, { status: 400 })
}
