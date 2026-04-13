// ============================================================
// PÁGINA CONVERSACIONES — Lista de chats del agente IA
// Ruta: /dashboard/conversations
// ============================================================

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ConversationsPanel } from '@/components/dashboard/conversations-panel'

export const dynamic = 'force-dynamic'

export default async function ConversationsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard')

  if (!session.permissions.conversations?.read) {
    return (
      <div className="p-6 lg:p-8">
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-slate-900 font-medium">No tienes permiso para ver conversaciones</p>
        </div>
      </div>
    )
  }

  // Cargar conversaciones con último mensaje
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('id, status, last_message_at, whatsapp_phone, patients(name, phone)')
    .eq('clinic_id', session.clinicId)
    .order('last_message_at', { ascending: false })
    .limit(200)

  // Para cada conversación, obtener último mensaje y conteo
  const entries = await Promise.all(
    (conversations ?? []).map(async (conv) => {
      const patient = conv.patients as unknown as { name: string; phone: string } | null

      const { data: lastMsg } = await supabaseAdmin
        .from('messages')
        .select('content, role')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const { count } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)

      return {
        id: conv.id,
        patient_name: patient?.name ?? 'Desconocido',
        patient_phone: patient?.phone ?? conv.whatsapp_phone,
        status: conv.status as 'active' | 'escalated' | 'resolved',
        last_message_at: conv.last_message_at,
        last_message_preview: lastMsg
          ? lastMsg.content.length > 60
            ? lastMsg.content.slice(0, 60) + '...'
            : lastMsg.content
          : '',
        last_message_role: lastMsg?.role ?? '',
        message_count: count ?? 0,
      }
    })
  )

  // Ordenar: escaladas primero, luego por fecha
  entries.sort((a, b) => {
    if (a.status === 'escalated' && b.status !== 'escalated') return -1
    if (b.status === 'escalated' && a.status !== 'escalated') return 1
    return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  })

  // Contadores
  const counts = {
    all: entries.length,
    active: entries.filter((e) => e.status === 'active').length,
    escalated: entries.filter((e) => e.status === 'escalated').length,
    resolved: entries.filter((e) => e.status === 'resolved').length,
  }

  // Verificar si hay número de escalamiento configurado
  const { data: clinicEsc } = await supabaseAdmin
    .from('clinics')
    .select('escalation_contact_phone')
    .eq('id', session.clinicId)
    .maybeSingle()
  const hasEscalationPhone = !!((clinicEsc as Record<string, unknown> | null)?.escalation_contact_phone as string | null)?.trim()

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {!hasEscalationPhone && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800">No tienes un número de alertas configurado</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Cuando un paciente necesite ayuda urgente, nadie será notificado.{' '}
              <a href="/dashboard/settings/clinic" className="underline font-medium">Configúralo aquí →</a>
            </p>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Conversaciones</h1>
        <p className="text-slate-500 text-sm">Historial de chats del agente IA con pacientes</p>
      </div>

      <ConversationsPanel entries={entries} counts={counts} />
    </div>
  )
}
