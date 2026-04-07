// ============================================================
// DETALLE DE CONVERSACIÓN — Chat completo con paciente
// Ruta: /dashboard/conversations/[id]
// ============================================================

import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ConversationChat } from '@/components/dashboard/conversation-chat'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ConversationDetailPage({ params }: Props) {
  const { id } = await params
  const session = await getUserSession()
  if (!session) redirect('/login')

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

  // Cargar conversación
  const { data: conv, error } = await supabaseAdmin
    .from('conversations')
    .select('id, status, escalated_to, escalated_at, created_at, whatsapp_phone, patients(name, phone)')
    .eq('id', id)
    .eq('clinic_id', session.clinicId)
    .single()

  if (error || !conv) {
    return (
      <div className="p-6 lg:p-8">
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-slate-900 font-medium mb-2">Conversación no encontrada</p>
          <Link href="/dashboard/conversations" className="text-sm text-blue-600 hover:text-blue-700">
            Volver a conversaciones
          </Link>
        </div>
      </div>
    )
  }

  const patient = conv.patients as unknown as { name: string; phone: string } | null

  // Cargar mensajes
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, message_type, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(500)

  const conversation = {
    id: conv.id,
    patient_name: patient?.name ?? 'Desconocido',
    patient_phone: patient?.phone ?? conv.whatsapp_phone,
    status: conv.status as 'active' | 'escalated' | 'resolved',
    escalated_to: conv.escalated_to,
    escalated_at: conv.escalated_at,
    created_at: conv.created_at,
  }

  const messageList = (messages ?? []).map((m) => ({
    id: m.id,
    role: m.role as 'patient' | 'agent' | 'staff',
    content: m.content,
    message_type: m.message_type,
    created_at: m.created_at,
  }))

  const canWrite = session.permissions.conversations?.write ?? false

  return (
    <div className="h-screen flex flex-col">
      <ConversationChat
        conversation={conversation}
        initialMessages={messageList}
        canWrite={canWrite}
      />
    </div>
  )
}
