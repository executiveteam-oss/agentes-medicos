// ============================================================
// CRON JOB: Resumen diario del médico (6am Colombia)
// Se ejecuta a las 11:00 UTC = 6:00 AM Colombia.
//
// Cada médico activo con teléfono recibe por WhatsApp SOLO sus citas del
// día (cantidad + hora + paciente). Resumen simple, sin acciones.
//
// Envío por TEMPLATE aprobado (resumen_diario_medico) — a las 6am el médico
// está fuera de la ventana de 24h, texto libre fallaría con 131047.
// Intentar-y-fallar-elegante: si el template no está aprobado en el Meta de
// la clínica → sendWhatsAppTemplate devuelve {ok:false} y se loguea.
//
// Multi-tenant: cada clínica debe aprobar su propio resumen_diario_medico.
//
// Schedule: "0 11 * * *" (6am Colombia)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppTemplate, getClinicCreds } from '@/lib/whatsapp/client'
import { RESUMEN_TEMPLATE_NAME, TEMPLATE_LANGUAGE } from '@/lib/whatsapp/appointment-templates'
import { formatTimeForPatient, nowColombia } from '@/lib/utils/dates'
import { checkRateLimit, RATE_LIMITS, verifyCronSecret } from '@/lib/rate-limit'
import { format } from 'date-fns'
import { toTitleCase } from '@/lib/utils/normalize-name'
// El predicado de "¿este blocked_external es una paciente real?" vive en un solo
// lugar y lo comparte con el calendario. Duplicarlo acá era garantizar que un día
// el resumen y la agenda contaran distinto.
import { esCupoCompartido } from '@/components/dashboard/calendar/types'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const rateLimit = checkRateLimit('cron:morning-report', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  console.log('[Cron:MorningReport] Generando resúmenes diarios...')

  try {
    const { data: clinics } = await supabaseAdmin
      .from('clinics')
      .select('id, name')
      .in('subscription_status', ['trial', 'active'])

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const clinic of clinics ?? []) {
      try {
        const r = await sendClinicDoctorSummaries(clinic.id)
        sent += r.sent
        skipped += r.skipped
      } catch (err) {
        failed++
        console.error(`[Cron:MorningReport] Error en clínica ${clinic.name} (${clinic.id}):`, err)
      }
    }

    console.log(`[Cron:MorningReport] Completado — ${sent} enviados, ${skipped} sin citas, ${failed} clínicas con error`)
    return NextResponse.json({ status: 'ok', sent, skipped, failed })
  } catch (error) {
    console.error('[Cron:MorningReport] Error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

/**
 * Para una clínica: envía a CADA médico activo con teléfono el resumen de
 * SUS citas de hoy. Médico sin citas → no se le manda nada.
 */
async function sendClinicDoctorSummaries(clinicId: string): Promise<{ sent: number; skipped: number }> {
  const { data: doctors } = await supabaseAdmin
    .from('doctors')
    .select('id, name, phone, daily_summary_enabled')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .eq('daily_summary_enabled', true)

  const withPhone = (doctors ?? []).filter((d) => d.phone && d.phone.trim() !== '')
  if (withPhone.length === 0) return { sent: 0, skipped: 0 }

  const creds = await getClinicCreds(clinicId)
  if (!creds) {
    console.warn(`[Cron:MorningReport] Clínica sin WhatsApp: ${clinicId}`)
    return { sent: 0, skipped: 0 }
  }

  const today = format(nowColombia(), 'yyyy-MM-dd')
  let sent = 0
  let skipped = 0

  for (const doctor of withPhone) {
    // Citas de HOY de ESTE médico (todo el día), con nombre del paciente, por hora.
    const { data: appts } = await supabaseAdmin
      .from('appointments')
      .select('starts_at, status, reason, external_data, patients(name)')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctor.id)
      // `blocked_external` VA INCLUIDO. No es "un bloqueo de agenda": son citas
      // reales que el sync degradó porque iSalud las puso en un cupo ya ocupado
      // y el índice único no admite dos con el mismo inicio. Excluirlas hacía
      // que a la médica le faltara una paciente en su propio resumen — el
      // 2026-08-10, Lina iba a leer "12 citas" con 13 pacientes en la sala.
      // El filtro fino (paciente real vs bloqueo vacío) va abajo, con la misma
      // función que usa el calendario.
      .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
      .gte('starts_at', `${today}T00:00:00-05:00`)
      .lte('starts_at', `${today}T23:59:59-05:00`)
      .order('starts_at', { ascending: true })

    // Un `blocked_external` SIN paciente sí es un bloqueo de agenda y no es una
    // cita: no se cuenta ni se lista.
    const rows = (appts ?? []).filter(
      (a) => a.status !== 'blocked_external' || esCupoCompartido(a.status as string, a.reason as string | null),
    )
    if (rows.length === 0) {
      skipped++ // sin citas hoy → no se le manda nada
      continue
    }

    const listItems = rows.map((a) => {
      // Hora en *negrita*: es el único recurso de formato que sobrevive dentro
      // de un parámetro de template. Meta rechaza `\n` (132018, verificado
      // contra la API), así que la lista va sí o sí en una sola línea — y sin
      // anclas visuales, 13 citas seguidas no se leen.
      const time = formatTimeForPatient(a.starts_at as string)
      // Las citas importadas del HIS que todavía no tienen ficha vinculada
      // salían como el literal "Paciente" — 1 de cada 3 de la semana. El nombre
      // NO estaba perdido: viaja en external_data.nombre_paciente desde el
      // scrape. Se usa como fallback antes de rendirse al genérico.
      const linkedName = (a.patients as unknown as { name: string } | null)?.name
      const externalName = ((a.external_data as { nombre_paciente?: string } | null)?.nombre_paciente ?? '').trim()
      const patientName = linkedName || externalName || 'Paciente'
      // Title Case, NO abreviado. iSalud manda todo en MAYÚSCULAS y con espacios
      // dobles; `toTitleCase` arregla las dos cosas. Acortar el nombre a dos
      // palabras dejaba "Luz Elena" sin apellido — con dos pacientes de nombre
      // parecido el mismo día, eso es un error de identificación, no de estilo.
      return `*${time}* ${toTitleCase(patientName)}`
    })

    const count = rows.length
    // {{2}} = cantidad (pluralizada) + lista, TODO en una línea (sin newlines).
    const countLabel = count === 1 ? '1 cita' : `${count} citas`
    const secondVar = `${countLabel} — ${listItems.join('  ·  ')}`

    const whatsappNumber = (doctor.phone as string).replace('+', '')
    const result = await sendWhatsAppTemplate(
      whatsappNumber,
      RESUMEN_TEMPLATE_NAME,
      TEMPLATE_LANGUAGE,
      [toTitleCase(doctor.name as string), secondVar],
      null, // sin botones
      creds,
      { clinicId, sendType: 'morning_report' },
    )

    if (result.ok) {
      sent++
      console.log(`[Cron:MorningReport] Resumen enviado a ${doctor.name} (${count} citas)`)
    } else {
      console.error(`[Cron:MorningReport] Falló resumen a ${doctor.name}: code ${result.errorCode ?? '?'}`)
    }
  }

  return { sent, skipped }
}
