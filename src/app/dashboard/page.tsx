// ============================================================
// DASHBOARD — Agenda con vista Día / Semana / Mes
// Ruta: /dashboard
//
// Carga todas las citas del mes actual (con padding para semanas)
// y las pasa al componente CalendarView para renderizar.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorUnlinked, getRestrictedDoctorId } from '@/lib/doctor-filter'
import { DoctorUnlinkedBanner } from '@/components/dashboard/doctor-unlinked-banner'
import { nowColombia, formatCOP } from '@/lib/utils/dates'
import { festivosProximos } from '@/lib/utils/festivos'
import { NewAppointmentButton } from '@/components/dashboard/dashboard-actions'
import { CalendarView } from '@/components/dashboard/calendar-view'
import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import type { CalendarAppointment, CalendarDoctor } from '@/components/dashboard/calendar-view'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { getSetupProgress } from '@/app/actions/setup-progress'
import { SetupChecklist } from '@/components/dashboard/setup-checklist'
import { ISaludSyncButton } from '@/components/dashboard/isalud-sync-button'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const now = nowColombia()
  const today = format(now, 'yyyy-MM-dd')
  const todayFormatted = format(now, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })

  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorUnlinked(session)) return <DoctorUnlinkedBanner />

  const restrictDoctorId = getRestrictedDoctorId(session)

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('*')
    .eq('id', session.clinicId)
    .single()

  if (!clinic) {
    return (
      <div className="p-8">
        <div className="card p-12 text-center">
          <p className="text-4xl mb-4">🏥</p>
          <p className="text-slate-900 font-semibold text-lg mb-1">No hay clínica configurada</p>
          <p className="text-slate-500 text-sm">Completa el onboarding para empezar</p>
        </div>
      </div>
    )
  }

  // Doctores activos (para el modal de nueva cita)
  const { data: activeDoctors } = await supabaseAdmin
    .from('doctors')
    .select('id, name, specialty, agenda_closed')
    .eq('clinic_id', clinic.id)
    .eq('is_active', true)
    .order('name')

  // Rango de carga: desde 7 días antes del inicio del mes hasta 7 días después del fin
  // Esto asegura que las vistas de semana en los bordes del mes tengan datos
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const rangeStart = new Date(monthStart)
  rangeStart.setDate(rangeStart.getDate() - 7)
  const rangeEnd = new Date(monthEnd)
  rangeEnd.setDate(rangeEnd.getDate() + 7)

  const rangeStartStr = format(rangeStart, 'yyyy-MM-dd')
  const rangeEndStr = format(rangeEnd, 'yyyy-MM-dd')

  // Citas del rango con datos del paciente y doctor
  let aptsQuery = supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, ends_at, status, reason, reminder_24h_sent, reminder_confirmed,
      payment_type, invoice_status, outstanding_balance, doctor_id, modality, virtual_link,
      documents_requested, documents_received, free_text_reason,
      patients(id, name, phone, no_show_probability, no_show_count, total_appointments, document_type, document_number, date_of_birth, doctor_notes, data_consent_at),
      doctors(name, specialty)
    `)
    .eq('clinic_id', clinic.id)
    .in('status', ['confirmed', 'rescheduled', 'completed', 'no_show', 'blocked_external'])
    .gte('starts_at', `${rangeStartStr}T00:00:00-05:00`)
    .lte('starts_at', `${rangeEndStr}T23:59:59-05:00`)
    .order('starts_at', { ascending: true })

  if (restrictDoctorId) {
    aptsQuery = aptsQuery.eq('doctor_id', restrictDoctorId)
  }

  const { data: rawAppointments, error: aptsError } = await aptsQuery
  console.log(`[Dashboard] Raw query: ${rawAppointments?.length ?? 0} rows, error: ${aptsError?.message ?? 'none'}, range: ${rangeStartStr} → ${rangeEndStr}`)
  if (rawAppointments && rawAppointments.length > 0) {
    const rawStatusCounts: Record<string, number> = {}
    rawAppointments.forEach((a) => { rawStatusCounts[String(a.status)] = (rawStatusCounts[String(a.status)] ?? 0) + 1 })
    console.log(`[Dashboard] Raw status counts: ${JSON.stringify(rawStatusCounts)}`)
  }

  // Mapear a la interfaz del calendario
  const appointments: CalendarAppointment[] = (rawAppointments ?? []).map((apt) => {
    const raw = apt as Record<string, unknown>
    const patients = raw.patients as CalendarAppointment['patient']
    const doctorsRel = raw.doctors as CalendarAppointment['doctor']
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      ends_at: apt.ends_at as string,
      status: apt.status as string,
      reason: (apt.reason as string) ?? null,
      reminder_24h_sent: (apt.reminder_24h_sent as boolean) ?? false,
      reminder_confirmed: (raw.reminder_confirmed as boolean | null) ?? null,
      payment_type: (apt.payment_type as string) ?? 'Particular',
      invoice_status: (raw.invoice_status as string) ?? 'pendiente',
      outstanding_balance: (raw.outstanding_balance as number) ?? null,
      modality: (raw.modality as string) ?? 'presencial',
      virtual_link: (raw.virtual_link as string) ?? null,
      documents_requested: (raw.documents_requested as boolean) ?? false,
      documents_received: (raw.documents_received as boolean) ?? false,
      free_text_reason: (raw.free_text_reason as string) ?? null,
      doctor_id: (raw.doctor_id as string) ?? null,
      patient: patients ?? null,
      doctor: doctorsRel ?? null,
    }
  })

  // Debug: count by status
  const statusCounts: Record<string, number> = {}
  appointments.forEach((a) => { statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1 })
  console.log(`[Dashboard] ${appointments.length} appointments loaded: ${JSON.stringify(statusCounts)}, range: ${rangeStartStr} → ${rangeEndStr}`)

  // Doctors list for calendar tabs
  const calendarDoctors: CalendarDoctor[] = (activeDoctors ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    agenda_closed: (d.agenda_closed as boolean) ?? false,
  }))

  // Estadísticas rápidas
  const todayAppts = appointments.filter((a) => {
    const d = new Date(a.starts_at)
    const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
    const colStr = `${col.getUTCFullYear()}-${String(col.getUTCMonth() + 1).padStart(2, '0')}-${String(col.getUTCDate()).padStart(2, '0')}`
    return colStr === today
  })
  const completedToday = todayAppts.filter((a) => a.status === 'completed').length
  const dailyGoal = clinic.daily_goal_appointments ?? 8

  let allTimeQuery = supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinic.id)
    .in('status', ['completed', 'no_show'])
  if (restrictDoctorId) allTimeQuery = allTimeQuery.eq('doctor_id', restrictDoctorId)
  const { count: totalAllTime } = await allTimeQuery

  let noShowQuery = supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinic.id)
    .eq('status', 'no_show')
  if (restrictDoctorId) noShowQuery = noShowQuery.eq('doctor_id', restrictDoctorId)
  const { count: totalNoShows } = await noShowQuery

  const noShowRate = totalAllTime && totalAllTime > 0
    ? Math.round(((totalNoShows ?? 0) / totalAllTime) * 100)
    : 0

  // Checklist de activación (solo para admins)
  const setupProgress = !restrictDoctorId ? await getSetupProgress().catch(() => null) : null

  // Festivos en los próximos 3 días
  const festivosAlert = festivosProximos(3)

  // iSalud integration status
  const { data: isalud } = await supabaseAdmin
    .from('sync_integrations')
    .select('sync_status, last_synced_at, sync_error')
    .eq('clinic_id', session.clinicId)
    .eq('provider', 'isalud')
    .maybeSingle()
  const isaludIntegration = isalud as { sync_status: string; last_synced_at: string | null; sync_error: string | null } | null

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Top bar */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{clinic.name}</h1>
          {Array.isArray(clinic.specialty) && clinic.specialty.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {clinic.specialty.map((spec: string) => (
                <span key={spec} className="badge badge-blue">{spec}</span>
              ))}
            </div>
          )}
          <p className="text-slate-500 capitalize text-sm mt-1">{todayFormatted}</p>
        </div>
        {!restrictDoctorId && (
          <div className="flex items-center gap-3">
            <ISaludSyncButton integration={isaludIntegration} />
            <NewAppointmentButton
              doctors={(activeDoctors ?? []) as { id: string; name: string; specialty: string | null }[]}
              minBookingAdvanceHours={clinic.min_booking_advance_hours ?? 24}
            />
          </div>
        )}
      </div>

      {/* Alerta festivos */}
      {festivosAlert.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <span className="text-sm">📅</span>
          </div>
          <p className="text-amber-800 text-sm font-medium">
            Festivo próximo: {festivosAlert.map((f) => `${f.nombre} (${f.fecha})`).join(', ')}
          </p>
        </div>
      )}

      {/* Checklist de activación */}
      {setupProgress && !setupProgress.completed_at && (
        <SetupChecklist progress={setupProgress} />
      )}
      {/* Show celebration for 3 days after completion */}
      {setupProgress?.completed_at && (() => {
        const completed = new Date(setupProgress.completed_at!)
        const threeDays = new Date(completed.getTime() + 3 * 24 * 60 * 60 * 1000)
        return new Date() < threeDays
      })() && (
        <SetupChecklist progress={setupProgress} />
      )}

      {/* Banner punto de equilibrio + stats (actualización en tiempo real) */}
      <DashboardStats
        initialTodayCount={todayAppts.length}
        initialCompletedToday={completedToday}
        dailyGoal={dailyGoal}
        noShowRate={noShowRate}
        clinicId={clinic.id}
        todayDateStr={today}
      />

      {/* Calendario */}
      <CalendarView
        appointments={appointments}
        initialDate={today}
        clinicName={clinic.name ?? ''}
        doctors={calendarDoctors}
        restrictDoctorId={session.doctorId}
        userRole={session.role.name}
        clinicId={clinic.id}
      />
    </div>
  )
}
