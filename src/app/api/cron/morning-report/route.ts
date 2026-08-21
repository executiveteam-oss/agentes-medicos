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
import { ESTADOS_VIVOS } from '@/lib/clinic/clinicas-vivas'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const rateLimit = checkRateLimit('cron:morning-report', RATE_LIMITS.cron)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // ── MODO PRUEBA ────────────────────────────────────────────────
  // `?test_phone=+57...` manda UN solo resumen a ese número y NO le escribe a
  // ningún médico. Existe porque un envío que sale bien no se puede verificar de
  // otra forma: hay que verlo llegar. Sin esto, la única prueba real era
  // dispararle a los 7 médicos y preguntarles.
  //
  // Va protegido por CRON_SECRET, igual que el resto del endpoint.
  const testPhone = request.nextUrl.searchParams.get('test_phone')?.trim() || null
  if (testPhone && !/^\+57[0-9]{10}$/.test(testPhone)) {
    return NextResponse.json({ error: 'test_phone inválido: se espera +57 y 10 dígitos' }, { status: 400 })
  }

  console.log(testPhone
    ? `[Cron:MorningReport] MODO PRUEBA — destino único ${testPhone.slice(0, 6)}…, no se le escribe a ningún médico`
    : '[Cron:MorningReport] Generando resúmenes diarios...')

  try {
    const { data: clinics } = await supabaseAdmin
      .from('clinics')
      .select('id, name')
      .in('subscription_status', ESTADOS_VIVOS as unknown as string[])

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const clinic of clinics ?? []) {
      try {
        const r = await sendClinicDoctorSummaries(clinic.id, testPhone)
        // En modo prueba se manda UNO y se corta: no tiene sentido repetirle el
        // mismo mensaje al mismo teléfono.
        //
        // El corte va condicionado a que efectivamente se haya ENVIADO algo. La
        // primera versión cortaba en la primera clínica sin más, y como el loop
        // arranca por una sin médicos habilitados, devolvía {sent:0} sin haber
        // llegado nunca a la clínica que sí tenía agenda: una prueba que no
        // probaba nada y parecía un fallo de envío.
        if (testPhone && r.sent > 0) {
          return NextResponse.json({ status: 'ok', modo: 'prueba', destino: testPhone, ...r })
        }
        sent += r.sent
        skipped += r.skipped
      } catch (err) {
        failed++
        console.error(`[Cron:MorningReport] Error en clínica ${clinic.name} (${clinic.id}):`, err)
      }
    }

    console.log(`[Cron:MorningReport] Completado — ${sent} enviados, ${skipped} sin citas, ${failed} clínicas con error`)
    // En modo prueba, llegar hasta acá significa que ninguna clínica tenía un
    // médico con citas hoy: no se envió nada y la prueba no probó el camino.
    if (testPhone) {
      return NextResponse.json({
        status: 'sin_envio', modo: 'prueba', destino: testPhone,
        motivo: 'Ninguna clínica tenía un médico habilitado con citas hoy',
        sent, skipped, failed,
      })
    }
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
async function sendClinicDoctorSummaries(
  clinicId: string,
  /** Si viene, TODO se manda a este número y NUNCA al teléfono del médico.
   *  Es un override de destinatario, no un filtro: la selección de médicos, la
   *  query de citas, el template y el formato son exactamente los de siempre. */
  testPhone: string | null = null,
): Promise<{ sent: number; skipped: number }> {
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
      await registrarResumen(clinicId, doctor.id as string, doctor.name as string, 'sin_citas', 0, null)
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

    // El override gana SIEMPRE. Escrito así —y no con un if más arriba— para que
    // no exista ninguna rama en la que `test_phone` esté puesto y el mensaje
    // salga igual al teléfono del médico.
    const destino = testPhone ?? (doctor.phone as string)
    const whatsappNumber = destino.replace('+', '')
    const result = await sendWhatsAppTemplate(
      whatsappNumber,
      RESUMEN_TEMPLATE_NAME,
      TEMPLATE_LANGUAGE,
      [toTitleCase(doctor.name as string), secondVar],
      null, // sin botones
      creds,
      { clinicId, sendType: testPhone ? 'morning_report_test' : 'morning_report' },
    )

    if (result.ok) {
      sent++
      console.log(`[Cron:MorningReport] Resumen enviado a ${testPhone ? 'NÚMERO DE PRUEBA' : doctor.name} (${count} citas) wamid=${result.messageId ?? 'SIN ID'}`)
      // El wamid es lo único que permite cruzar "lo mandé" con "llegó": es el id
      // que devuelve Meta al aceptar y el mismo que viaja en los status updates.
      // Sin guardarlo, el estado de entrega llega al webhook y no se puede
      // asociar a ningún médico.
      await registrarResumen(clinicId, doctor.id as string, doctor.name as string, testPhone ? 'prueba' : 'enviado', count, null, result.messageId ?? null)
    } else {
      console.error(`[Cron:MorningReport] Falló resumen a ${testPhone ? 'NÚMERO DE PRUEBA' : doctor.name}: code ${result.errorCode ?? '?'}`)
      await registrarResumen(clinicId, doctor.id as string, doctor.name as string, testPhone ? 'prueba_fallo' : 'fallo', count, result.errorCode ?? null)
    }

    // En modo prueba: uno y listo.
    if (testPhone) break
  }

  return { sent, skipped }
}

/**
 * Deja constancia del resumen de CADA médico, en los tres desenlaces.
 *
 * POR QUÉ EXISTE: hasta el 2026-08-14 este cron solo hacía console.log. Los
 * fallos quedaban en `whatsapp_send_failed`, pero los ÉXITOS no dejaban rastro
 * en ningún lado — así que la pregunta "¿le llegó el resumen a los médicos?" no
 * tenía respuesta posible: cero filas significaba lo mismo que nunca corrió,
 * que corrió y salió bien, o que nadie tenía citas.
 *
 * Por eso se registra también `sin_citas`: el día que a un médico no le llegue,
 * lo primero que hay que poder distinguir es "no tenía pacientes" de "se cayó".
 * Sin esa fila, las dos se ven idénticas — ausencia de registro.
 *
 * No es crítico: si falla el registro, el resumen ya se envió y eso importa más.
 */
async function registrarResumen(
  clinicId: string,
  doctorId: string,
  doctorName: string,
  resultado: 'enviado' | 'sin_citas' | 'fallo' | 'prueba' | 'prueba_fallo',
  citas: number,
  metaCode: number | string | null,
  /** wamid de Meta. Es la llave para cruzar con whatsapp_message_status y saber
   *  si el resumen se ENTREGÓ, no solo si Meta lo aceptó. */
  wamid: string | null = null,
): Promise<void> {
  try {
    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'morning_report_sent',
      actor_type: 'system',
      target_type: 'doctor',
      target_id: doctorId,
      details: {
        resultado,
        doctor_name: doctorName,
        citas,
        fecha: format(nowColombia(), 'yyyy-MM-dd'),
        ...(wamid ? { wamid } : {}),
        ...(metaCode !== null ? { meta_code: metaCode } : {}),
      },
    })
  } catch (err) {
    console.error('[Cron:MorningReport] No se pudo registrar en audit_log:', err)
  }
}
