// ============================================================
// CRON JOB: Reabrir agendas de doctores cuya fecha límite expiró
// Se ejecuta diariamente (configurado en vercel.json)
// Busca doctores con agenda_closed=true y agenda_closed_until <= hoy
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/rate-limit'
import { clinicasVivas } from '@/lib/clinic/clinicas-vivas'
import { nowColombia } from '@/lib/utils/dates'
import { format } from 'date-fns'

export const maxDuration = 10

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  // Fecha de hoy en Colombia (UTC-5)
  const todayStr = format(nowColombia(), 'yyyy-MM-dd')

  // Sólo médicos de clínicas vivas. Antes barría la tabla entera: reabría la
  // agenda de un médico de una clínica de prueba y lo dejaba en audit_log de
  // esa clínica, sin que nadie lo mirara nunca.
  const clinicas = await clinicasVivas('id')
  const clinicIds = clinicas.map((c) => c.id)
  console.log(`[Cron:ReopenAgendas] clínicas vivas: ${clinicIds.length}`)
  if (clinicIds.length === 0) return NextResponse.json({ reopened: 0, clinicas: 0 })

  // Buscar doctores cuya agenda cerrada ya venció
  const { data: doctors, error } = await supabaseAdmin
    .from('doctors')
    .select('id, clinic_id, name, agenda_closed_until')
    .in('clinic_id', clinicIds)
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
      .eq('clinic_id', doc.clinic_id)

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
