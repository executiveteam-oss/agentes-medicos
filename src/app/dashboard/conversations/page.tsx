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

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Conversaciones</h1>
        <p className="text-slate-500 text-sm">Historial de chats del agente IA con pacientes</p>
      </div>

      <ConversationsPanel entries={entries} counts={counts} />
    </div>
  )
}
