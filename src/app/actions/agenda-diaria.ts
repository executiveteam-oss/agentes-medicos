'use server'

// ============================================================
// Descargar la agenda del día de un médico en PDF, para imprimir.
//
// Devuelve el PDF en base64 y no por un route handler: así el permiso lo
// resuelve `checkReadPermission` con la sesión, igual que el resto del
// dashboard, sin inventar otra puerta de autenticación.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission, extractActionError } from '@/lib/actions-helpers'
import { buildAgendaDiariaPdf } from '@/lib/reports/agenda-diaria/build-pdf'
import { armarFilasAgenda, type CitaParaAgenda } from '@/lib/reports/agenda-diaria/armar-filas'
import { formatInTimeZone } from 'date-fns-tz'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export interface AgendaDiariaResult {
  ok: boolean
  error?: string
  /** PDF en base64, listo para Blob en el cliente. */
  pdfBase64?: string
  filename?: string
  citas?: number
}

/**
 * @param fecha  YYYY-MM-DD en hora de Colombia.
 */
export async function descargarAgendaDiaria(
  doctorId: string,
  fecha: string,
): Promise<AgendaDiariaResult> {
  let clinicId: string
  try { clinicId = await checkReadPermission('agenda') }
  catch (err) { return { ok: false, error: extractActionError(err) } }

  if (!doctorId) return { ok: false, error: 'Elegí un médico: la agenda se imprime de a uno.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: 'Fecha inválida' }

  const { data: doctor } = await supabaseAdmin
    .from('doctors').select('name, specialty').eq('id', doctorId).eq('clinic_id', clinicId).maybeSingle()
  if (!doctor) return { ok: false, error: 'Médico no encontrado' }

  const { data: clinic } = await supabaseAdmin
    .from('clinics').select('name').eq('id', clinicId).single()

  // El día completo en hora de Colombia: la cita de las 7:00 AM del 20 se
  // guarda como 12:00 UTC, así que un rango sin offset se lleva el día vecino.
  const { data: citas } = await supabaseAdmin
    .from('appointments')
    .select(`starts_at, reason, eps_name, payment_type, external_service_name, external_data,
             doctors(name, specialty), patients(name, document_type, document_number),
             consultation_types(name)`)
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'rescheduled', 'blocked_external'])
    .gte('starts_at', `${fecha}T00:00:00-05:00`)
    .lte('starts_at', `${fecha}T23:59:59-05:00`)
    .order('starts_at', { ascending: true })

  const normalizadas: CitaParaAgenda[] = (citas ?? []).map((c) => {
    const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
    return {
      starts_at: c.starts_at as string,
      reason: c.reason as string | null,
      eps_name: c.eps_name as string | null,
      payment_type: c.payment_type as string | null,
      external_service_name: c.external_service_name as string | null,
      external_data: c.external_data as Record<string, unknown> | null,
      doctor: uno(c.doctors as never),
      patient: uno(c.patients as never),
      consultation_type: uno(c.consultation_types as never),
    }
  })

  try {
    const bytes = await buildAgendaDiariaPdf({
      doctorName: doctor.name as string,
      fechaLarga: format(parseISO(`${fecha}T12:00:00-05:00`), "EEEE d 'de' MMMM 'de' yyyy", { locale: es }),
      clinicName: (clinic?.name as string) ?? '',
      filas: armarFilasAgenda(normalizadas),
    })

    const slug = (doctor.name as string).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    return {
      ok: true,
      pdfBase64: Buffer.from(bytes).toString('base64'),
      filename: `agenda-${slug}-${formatInTimeZone(parseISO(`${fecha}T12:00:00-05:00`), 'America/Bogota', 'yyyy-MM-dd')}.pdf`,
      citas: normalizadas.length,
    }
  } catch (err) {
    console.error('[descargarAgendaDiaria] error generando el PDF:', err)
    return { ok: false, error: 'No se pudo generar el PDF. Intentá de nuevo.' }
  }
}
