// ============================================================
// AGENDA — CalendarView con vista Dia / Semana / Mes
// Ruta: /dashboard/agenda
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { getRestrictedDoctorId } from '@/lib/doctor-filter'
import { nowColombia } from '@/lib/utils/dates'
import { CalendarView } from '@/components/dashboard/calendar-view'
import type { CalendarAppointment, CalendarDoctor } from '@/components/dashboard/calendar-view'
import { getSurveyConfig } from '@/app/actions/survey-config'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

// Ancla de la ventana de citas. CalendarView escribe ?date= al navegar; sin leerlo,
// el server siempre traía el mes actual → cualquier mes hacia adelante salía vacío
// aunque las citas existieran en appointments. Valida el formato y cae a hoy.
function parseAnchorDate(raw: string | undefined, fallback: Date): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    if (!Number.isNaN(dt.getTime())) return dt
  }
  return fallback
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const now = nowColombia()
  const today = format(now, 'yyyy-MM-dd')

  // La ventana se ancla en el mes que se está viendo (?date=), no en hoy.
  const sp = await searchParams
  const anchor = parseAnchorDate(sp?.date, now)

  const session = await getUserSession()
  if (!session) redirect('/login')

  const restrictDoctorId = getRestrictedDoctorId(session)

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('id, name')
    .eq('id', session.clinicId)
    .single()

  if (!clinic) {
    return (
      <div className="space-y-6">
        <div className="card-v2 p-12 text-center">
          <p className="text-4xl mb-4">🏥</p>
          <p className="text-lg font-semibold" style={{ color: 'var(--v2-text)' }}>No hay clinica configurada</p>
        </div>
      </div>
    )
  }

  // Active doctors
  const { data: activeDoctors } = await supabaseAdmin
    .from('doctors')
    .select('id, name, specialty, agenda_closed')
    .eq('clinic_id', clinic.id)
    .eq('is_active', true)
    .order('name')

  // Date range: mes del ancla + 7 días de padding para semanas en los bordes
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const rangeStart = new Date(monthStart)
  rangeStart.setDate(rangeStart.getDate() - 7)
  const rangeEnd = new Date(monthEnd)
  rangeEnd.setDate(rangeEnd.getDate() + 7)

  const rangeStartStr = format(rangeStart, 'yyyy-MM-dd')
  const rangeEndStr = format(rangeEnd, 'yyyy-MM-dd')

  // Appointments query
  let aptsQuery = supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, ends_at, status, attendance_outcome, survey_sent, survey_sent_at,
      reason, reminder_24h_sent, reminder_confirmed,
      payment_type, source, doctor_id, modality, virtual_link,
      documents_requested, documents_received, free_text_reason,
      patients(id, name, phone, no_show_probability, no_show_count, total_appointments, document_type, document_number, date_of_birth, doctor_notes, data_consent_at, first_name, entidad),
      doctors(name, specialty),
      consultation_types(name)
    `)
    .eq('clinic_id', clinic.id)
    .in('status', ['confirmed', 'rescheduled', 'completed', 'no_show', 'blocked_external'])
    .gte('starts_at', `${rangeStartStr}T00:00:00-05:00`)
    .lte('starts_at', `${rangeEndStr}T23:59:59-05:00`)
    .order('starts_at', { ascending: true })

  if (restrictDoctorId) {
    aptsQuery = aptsQuery.eq('doctor_id', restrictDoctorId)
  }

  const { data: rawAppointments } = await aptsQuery

  const appointments: CalendarAppointment[] = (rawAppointments ?? []).map((apt) => {
    const raw = apt as Record<string, unknown>
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      ends_at: apt.ends_at as string,
      status: apt.status as string,
      attendance_outcome: (raw.attendance_outcome as CalendarAppointment['attendance_outcome']) ?? null,
      survey_sent: (raw.survey_sent as boolean) ?? false,
      survey_sent_at: (raw.survey_sent_at as string) ?? null,
      reason: (apt.reason as string) ?? null,
      reminder_24h_sent: (apt.reminder_24h_sent as boolean) ?? false,
      reminder_confirmed: (raw.reminder_confirmed as boolean | null) ?? null,
      payment_type: (apt.payment_type as string) ?? '',
      modality: (raw.modality as string) ?? 'presencial',
      virtual_link: (raw.virtual_link as string) ?? null,
      documents_requested: (raw.documents_requested as boolean) ?? false,
      documents_received: (raw.documents_received as boolean) ?? false,
      free_text_reason: (raw.free_text_reason as string) ?? null,
      consultation_type_name: (raw.consultation_types as { name: string } | null)?.name ?? null,
      source: (raw.source as string) ?? null,
      doctor_id: (raw.doctor_id as string) ?? null,
      patient: raw.patients as CalendarAppointment['patient'],
      doctor: raw.doctors as CalendarAppointment['doctor'],
    }
  })

  const calendarDoctors: CalendarDoctor[] = (activeDoctors ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    agenda_closed: (d.agenda_closed as boolean) ?? false,
  }))

  // Config de encuesta post-consulta para el botón manual en QuickActions.
  // Cargar acá evita fetch per-appointment en la UI.
  const surveyRaw = await getSurveyConfig()
  const surveyConfig = {
    enabled: surveyRaw.config.enabled,
    form_url: surveyRaw.config.form_url,
    clinic_display_name: surveyRaw.config.clinic_display_name || surveyRaw.clinicName,
  }

  return (
    <div className="space-y-6">
      <CalendarView
        appointments={appointments}
        initialDate={today}
        clinicName={clinic.name ?? ''}
        doctors={calendarDoctors}
        restrictDoctorId={session.doctorId}
        userRole={session.role.name}
        clinicId={clinic.id}
        surveyConfig={surveyConfig}
      />
    </div>
  )
}
