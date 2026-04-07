// ============================================================
// CRON JOB: Reabrir agendas de doctores cuya fecha límite expiró
// Se ejecuta diariamente (configurado en vercel.json)
// Busca doctores con agenda_closed=true y agenda_closed_until <= hoy
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/rate-limit'

export const maxDuration = 10

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  // Fecha de hoy en Colombia (UTC-5)
  const now = new Date()
  const colombiaDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  const todayStr = `${colombiaDate.getFullYear()}-${String(colombiaDate.getMonth() + 1).padStart(2, '0')}-${String(colombiaDate.getDate()).padStart(2, '0')}`

  // Buscar doctores cuya agenda cerrada ya venció
  const { data: doctors, error } = await supabaseAdmin
    .from('doctors')
    .select('id, clinic_id, name, agenda_closed_until')
    .eq('agenda_closed', true)
    .not('agenda_closed_until', 'is', null)
    .lte('agenda_closed_until', todayStr)

  if (error) {
    console.error('[Cron:ReopenAgendas] Error buscando doctores:', error)
    return NextResponse.json({ error: 'Error en DB' }, { status: 500 })
  }

  if (!doctors || doctors.length === 0) {
    return NextResponse.json({ reopened: 0 })
  }

  let reopened = 0

  for (const doc of doctors) {
    const { error: updateError } = await supabaseAdmin
      .from('doctors')
      .update({
        agenda_closed: false,
        agenda_closed_reason: null,
        agenda_closed_until: null,
      })
      .eq('id', doc.id)

    if (updateError) {
      console.error(`[Cron:ReopenAgendas] Error reabriendo ${doc.id}:`, updateError)
      continue
    }

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: doc.clinic_id,
      action: 'agenda_reopened_auto',
      actor_type: 'system',
      target_type: 'doctor',
      target_id: doc.id,
      details: { reason: 'Fecha límite alcanzada', agenda_closed_until: doc.agenda_closed_until },
    })

    reopened++
  }

  console.log(`[Cron:ReopenAgendas] Reabridas: ${reopened}/${doctors.length}`)
  return NextResponse.json({ reopened, total: doctors.length })
}
