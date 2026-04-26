// ============================================================
// DASHBOARD v2 — Hero, KPIs, Proximas Citas, Escalaciones
// Ruta: /dashboard
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorUnlinked, getRestrictedDoctorId } from '@/lib/doctor-filter'
import { DoctorUnlinkedBanner } from '@/components/dashboard/doctor-unlinked-banner'
import { nowColombia } from '@/lib/utils/dates'
import { festivosProximos } from '@/lib/utils/festivos'
import { NewAppointmentButton } from '@/components/dashboard/dashboard-actions'
import {
  HeroGreeting,
  KPIRow,
  UpcomingAppointmentsList,
  EscalatedCard,
  AgentWeekCard,
} from '@/components/dashboard/dashboard-v2'
import type { DashboardKPI, UpcomingAppointment, EscalatedConversation } from '@/components/dashboard/dashboard-v2'
import { redirect } from 'next/navigation'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { getSetupProgress } from '@/app/actions/setup-progress'
import { SetupChecklist } from '@/components/dashboard/setup-checklist'
import { ISaludSyncButton } from '@/components/dashboard/isalud-sync-button'

export const dynamic = 'force-dynamic'

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

function getGreeting(): string {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })).getHours()
  if (h >= 5 && h < 12) return 'Buenos dias'
  if (h >= 12 && h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

export default async function DashboardPage() {
  const now = nowColombia()
  const today = format(now, 'yyyy-MM-dd')

  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorUnlinked(session)) return <DoctorUnlinkedBanner />

  const restrictDoctorId = getRestrictedDoctorId(session)
  const firstName = session.fullName.split(' ')[0] ?? session.fullName

  // ---- Parallel queries ----
  const [clinicRes, doctorsRes] = await Promise.all([
    supabaseAdmin.from('clinics').select('*').eq('id', session.clinicId).single(),
    supabaseAdmin.from('doctors').select('id, name, specialty, agenda_closed').eq('clinic_id', session.clinicId).eq('is_active', true).order('name'),
  ])

  const clinic = clinicRes.data
  if (!clinic) {
    return (
      <div className="space-y-6">
        <div className="card-v2 p-12 text-center">
          <p className="text-4xl mb-4">🏥</p>
          <p className="text-lg font-semibold" style={{ color: 'var(--v2-text)' }}>No hay clinica configurada</p>
          <p className="text-sm mt-1" style={{ color: 'var(--v2-text-muted)' }}>Completa el onboarding para empezar</p>
        </div>
      </div>
    )
  }

  const activeDoctors = doctorsRes.data ?? []

  // ---- Today's appointments query (only today, not full month) ----
  const todayStartISO = new Date(new Date(`${today}T00:00:00-05:00`)).toISOString()
  const todayEndISO = new Date(new Date(`${today}T23:59:59-05:00`)).toISOString()

  let todayAptsQuery = supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, ends_at, status, reason, payment_type, doctor_id, free_text_reason,
      patients(id, name, phone),
      doctors(name)
    `)
    .eq('clinic_id', clinic.id)
    .in('status', ['confirmed', 'rescheduled', 'completed', 'no_show', 'blocked_external'])
    .gte('starts_at', todayStartISO)
    .lte('starts_at', todayEndISO)
    .order('starts_at', { ascending: true })

  if (restrictDoctorId) {
    todayAptsQuery = todayAptsQuery.eq('doctor_id', restrictDoctorId)
  }

  // ---- No-show stats ----
  let allTimeQuery = supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinic.id)
    .in('status', ['completed', 'no_show'])
  if (restrictDoctorId) allTimeQuery = allTimeQuery.eq('doctor_id', restrictDoctorId)

  let noShowQuery = supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinic.id)
    .eq('status', 'no_show')
  if (restrictDoctorId) noShowQuery = noShowQuery.eq('doctor_id', restrictDoctorId)

  // ---- Week stats ----
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
  const weekStartISO = new Date(weekStart.getTime() + 5 * 60 * 60 * 1000).toISOString()
  const weekEndISO = new Date(weekEnd.getTime() + 5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000 - 1).toISOString()

  // ---- Escalated conversations ----
  const escalatedQuery = supabaseAdmin
    .from('conversations')
    .select('id, last_message_at, patients(name)')
    .eq('clinic_id', session.clinicId)
    .eq('status', 'escalated')
    .order('last_message_at', { ascending: false })
    .limit(5)

  // ---- Run all queries in parallel ----
  const [
    todayAptsRes,
    allTimeRes,
    noShowRes,
    agentMsgTodayRes,
    agentMsgWeekRes,
    agentBookedRes,
    escalatedRes,
  ] = await Promise.all([
    todayAptsQuery,
    allTimeQuery,
    noShowQuery,
    supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).eq('role', 'agent').gte('created_at', todayStartISO).lte('created_at', todayEndISO),
    supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).eq('role', 'agent').gte('created_at', weekStartISO).lte('created_at', weekEndISO),
    supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', clinic.id).eq('source', 'whatsapp_agent').gte('created_at', weekStartISO).lte('created_at', weekEndISO),
    escalatedQuery,
  ])

  // ---- Map today's appointments ----
  interface TodayApt {
    id: string
    starts_at: string
    status: string
    reason: string | null
    payment_type: string
    free_text_reason: string | null
    patient: { id: string; name: string; phone: string } | null
    doctor: { name: string } | null
  }

  const todayAppts: TodayApt[] = (todayAptsRes.data ?? []).map((apt) => {
    const raw = apt as Record<string, unknown>
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      status: apt.status as string,
      reason: (apt.reason as string) ?? null,
      payment_type: (apt.payment_type as string) ?? 'Particular',
      free_text_reason: (raw.free_text_reason as string) ?? null,
      patient: raw.patients as TodayApt['patient'],
      doctor: raw.doctors as TodayApt['doctor'],
    }
  })

  // ---- KPIs ----
  const totalAllTime = allTimeRes.count ?? 0
  const totalNoShows = noShowRes.count ?? 0
  const noShowRate = totalAllTime > 0 ? Math.round((totalNoShows / totalAllTime) * 100) : 0

  const activeConvCount = (escalatedRes.data ?? []).length
  const agentMsgToday = agentMsgTodayRes.count ?? 0
  const agentMsgWeek = agentMsgWeekRes.count ?? 0
  const agentBooked = agentBookedRes.count ?? 0

  // Upcoming: confirmed/rescheduled today, starting from now
  const nowISO = now.toISOString()
  const upcomingAppts = todayAppts
    .filter((a) => (a.status === 'confirmed' || a.status === 'rescheduled') && a.starts_at > nowISO)
    .slice(0, 8)

  const upcoming: UpcomingAppointment[] = upcomingAppts.map((a) => ({
    id: a.id,
    startsAt: a.starts_at,
    patientName: a.patient?.name ?? 'Paciente',
    patientInitials: getInitials(a.patient?.name ?? 'P'),
    reason: a.reason ?? a.free_text_reason,
    doctorName: a.doctor?.name ?? null,
    paymentType: a.payment_type,
    status: a.status,
  }))

  // Escalated conversations
  const escalated: EscalatedConversation[] = (escalatedRes.data ?? []).map((conv) => {
    const raw = conv as Record<string, unknown>
    const patient = raw.patients as { name: string } | null
    const name = patient?.name ?? 'Paciente'
    return {
      id: conv.id as string,
      patientName: name,
      patientInitials: getInitials(name),
      lastMessage: 'Conversacion escalada — requiere atencion',
      timeAgo: conv.last_message_at as string,
    }
  })

  // KPI data
  const todayNonExternal = todayAppts.filter((a) => a.status !== 'blocked_external')
  const kpis: DashboardKPI[] = [
    {
      label: 'Citas hoy',
      value: todayNonExternal.length,
      detail: `${todayAppts.filter((a) => a.status === 'completed').length} completadas`,
      icon: 'calendar',
      color: 'primary',
    },
    {
      label: 'Tasa no-show',
      value: `${noShowRate}%`,
      detail: `${totalNoShows} de ${totalAllTime} citas`,
      icon: 'trending-down',
      color: noShowRate <= 15 ? 'green' : 'pink',
      trend: noShowRate <= 15 ? { value: '↓ Bien', positive: true } : undefined,
    },
    {
      label: 'Chats activos',
      value: activeConvCount,
      detail: activeConvCount > 0 ? 'Escaladas pendientes' : 'Sin escalaciones',
      icon: 'message',
      color: 'pink',
    },
    {
      label: 'Proximas hoy',
      value: upcomingAppts.length,
      detail: 'Citas restantes del dia',
      icon: 'clock',
      color: 'amber',
    },
  ]

  // Setup checklist
  const setupProgress = !restrictDoctorId ? await getSetupProgress().catch(() => null) : null

  // Festivos
  const festivosAlert = festivosProximos(3)

  // iSalud
  const { data: isalud } = await supabaseAdmin
    .from('sync_integrations')
    .select('sync_status, last_synced_at, sync_error')
    .eq('clinic_id', session.clinicId)
    .eq('provider', 'isalud')
    .maybeSingle()
  const isaludIntegration = isalud as { sync_status: string; last_synced_at: string | null; sync_error: string | null } | null

  // Dynamic greeting + day line
  const greeting = getGreeting()
  const dayLine = `${format(now, "EEEE d 'de' MMMM", { locale: es })} · ${todayNonExternal.length} citas hoy`

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <HeroGreeting
          greeting={greeting}
          firstName={firstName}
          dayLine={dayLine}
          agentActive={true}
          agentMessages={agentMsgToday}
        />
        {!restrictDoctorId && (
          <div className="flex items-center gap-3 shrink-0">
            <ISaludSyncButton integration={isaludIntegration} />
            <NewAppointmentButton
              doctors={activeDoctors as { id: string; name: string; specialty: string | null }[]}
              minBookingAdvanceHours={clinic.min_booking_advance_hours ?? 24}
            />
          </div>
        )}
      </div>

      {/* Festivos alert */}
      {festivosAlert.length > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: 'var(--v2-amber-soft)', border: '1px solid rgba(255, 184, 69, 0.3)' }}
        >
          <span className="text-sm">📅</span>
          <p className="text-sm font-medium" style={{ color: '#b07d00' }}>
            Festivo proximo: {festivosAlert.map((f) => `${f.nombre} (${f.fecha})`).join(', ')}
          </p>
        </div>
      )}

      {/* Setup checklist */}
      {setupProgress && !setupProgress.completed_at && (
        <SetupChecklist progress={setupProgress} />
      )}
      {setupProgress?.completed_at && (() => {
        const completed = new Date(setupProgress.completed_at!)
        const threeDays = new Date(completed.getTime() + 3 * 24 * 60 * 60 * 1000)
        return new Date() < threeDays
      })() && (
        <SetupChecklist progress={setupProgress} />
      )}

      {/* KPIs */}
      <KPIRow kpis={kpis} />

      {/* Main grid: left (upcoming) + right (attention + agent) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
        <UpcomingAppointmentsList appointments={upcoming} />
        <div className="space-y-6">
          <EscalatedCard conversations={escalated} />
          <AgentWeekCard
            messagesResolved={agentMsgWeek}
            avgResponseTime="< 1 min"
            appointmentsBooked={agentBooked}
          />
        </div>
      </div>
    </div>
  )
}
