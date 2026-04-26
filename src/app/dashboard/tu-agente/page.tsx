// ============================================================
// Tu Agente — Personalidad, conexion, comportamiento de Omu
// Ruta: /dashboard/tu-agente
// ============================================================

export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { TuAgenteClient } from '@/components/dashboard/tu-agente-client'
import { startOfWeek, endOfWeek } from 'date-fns'
import type { WhatsAppConfig } from '@/types/database'

export default async function TuAgentePage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard')

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('agent_name, agent_personality, welcome_message, clinic_info, whatsapp_config, whatsapp_connected, whatsapp_phone_display, whatsapp_phone_id, whatsapp_connected_at')
    .eq('id', session.clinicId)
    .single()

  if (!clinic) redirect('/dashboard')

  const whatsappConfig = (clinic.whatsapp_config ?? {
    schedule: { start: '07:00', end: '20:00', days: [1,2,3,4,5,6], out_of_hours_message: '' },
    appointment: { default_duration: 30, max_duration: 60 },
    escalation_keywords: [],
    doctors: {},
    automations: { post_consulta: { enabled: false }, reactivacion: { enabled: false, days_inactive: 90 } },
  }) as WhatsAppConfig

  // ---- Metrics (last 30 days) ----
  const now = new Date()
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const todayStart = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  todayStart.setHours(0, 0, 0, 0)
  const todayStartISO = new Date(todayStart.getTime() + 5 * 60 * 60 * 1000).toISOString()

  const [msgTodayRes, convsRes, agentBookedRes, convsResolvedRes, convsTotalRes] = await Promise.all([
    supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).eq('role', 'agent').gte('created_at', todayStartISO),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('clinic_id', session.clinicId).eq('status', 'active'),
    supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', session.clinicId).eq('source', 'whatsapp_agent').gte('created_at', thirtyDaysAgo.toISOString()),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('clinic_id', session.clinicId).eq('status', 'resolved').gte('created_at', thirtyDaysAgo.toISOString()),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('clinic_id', session.clinicId).gte('created_at', thirtyDaysAgo.toISOString()),
  ])

  const resolvedPct = (convsTotalRes.count ?? 0) > 0
    ? Math.round(((convsResolvedRes.count ?? 0) / (convsTotalRes.count ?? 1)) * 100)
    : 0

  return (
    <TuAgenteClient
      agentName={clinic.agent_name ?? 'Asistente'}
      agentPersonality={clinic.agent_personality ?? 'profesional y amable'}
      welcomeMessage={clinic.welcome_message ?? ''}
      clinicInfo={clinic.clinic_info ?? ''}
      whatsappConnected={!!(clinic.whatsapp_connected)}
      whatsappPhoneDisplay={clinic.whatsapp_phone_display ?? null}
      whatsappPhoneId={clinic.whatsapp_phone_id ?? null}
      whatsappConnectedAt={clinic.whatsapp_connected_at ?? null}
      escalationKeywords={whatsappConfig.escalation_keywords ?? []}
      automations={whatsappConfig.automations ?? { post_consulta: { enabled: false }, reactivacion: { enabled: false, days_inactive: 90 } }}
      metrics={{
        messagesToday: msgTodayRes.count ?? 0,
        activeConversations: convsRes.count ?? 0,
        appointmentsBooked30d: agentBookedRes.count ?? 0,
        resolvedWithoutHumanPct: resolvedPct,
      }}
      clinicId={session.clinicId}
    />
  )
}
