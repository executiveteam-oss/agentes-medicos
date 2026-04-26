// ============================================================
// DETALLE DE CONVERSACION — Chat + Context panel (v2)
// Ruta: /dashboard/conversations/[id]
// ============================================================

import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ConversationChat } from '@/components/dashboard/conversation-chat'
import Link from 'next/link'
import { nowColombia } from '@/lib/utils/dates'

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
        <div className="card-v2" style={{ padding: '48px', textAlign: 'center', maxWidth: '400px' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔒</p>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--v2-text)' }}>No tienes permiso</p>
        </div>
      </div>
    )
  }

  // Load conversation with patient details
  const { data: conv, error } = await supabaseAdmin
    .from('conversations')
    .select('id, status, escalated_to, escalated_at, created_at, whatsapp_phone, patient_id, patients(id, name, phone, eps, no_show_count, total_appointments, document_type, document_number, date_of_birth, created_at)')
    .eq('id', id)
    .eq('clinic_id', session.clinicId)
    .single()

  if (error || !conv) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
        <div className="card-v2" style={{ padding: '48px', textAlign: 'center', maxWidth: '400px' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</p>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--v2-text)', marginBottom: '8px' }}>Conversacion no encontrada</p>
          <Link href="/dashboard/conversations" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--v2-primary)', textDecoration: 'none' }}>
            ← Volver a conversaciones
          </Link>
        </div>
      </div>
    )
  }

  const patient = conv.patients as unknown as { id: string; name: string; phone: string; eps: string | null; no_show_count: number; total_appointments: number; document_type: string; document_number: string | null; date_of_birth: string | null; created_at: string } | null

  // Load messages
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, message_type, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(500)

  // Load next appointment for context panel
  const now = nowColombia()
  let nextAppointment = null
  if (patient?.id) {
    const { data: nextApt } = await supabaseAdmin
      .from('appointments')
      .select('id, starts_at, reason, status, doctors(name)')
      .eq('clinic_id', session.clinicId)
      .eq('patient_id', patient.id)
      .in('status', ['confirmed', 'rescheduled'])
      .gte('starts_at', now.toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (nextApt) {
      const doc = nextApt.doctors as unknown as { name: string } | null
      nextAppointment = {
        id: nextApt.id as string,
        starts_at: nextApt.starts_at as string,
        reason: nextApt.reason as string | null,
        doctor_name: doc?.name ?? null,
      }
    }
  }

  const conversation = {
    id: conv.id as string,
    patient_id: patient?.id ?? null,
    patient_name: patient?.name ?? 'Desconocido',
    patient_phone: patient?.phone ?? (conv.whatsapp_phone as string),
    patient_eps: patient?.eps ?? null,
    patient_no_show_count: patient?.no_show_count ?? 0,
    patient_total_appointments: patient?.total_appointments ?? 0,
    patient_document_type: patient?.document_type ?? null,
    patient_document_number: patient?.document_number ?? null,
    patient_date_of_birth: patient?.date_of_birth ?? null,
    patient_created_at: patient?.created_at ?? null,
    status: conv.status as 'active' | 'escalated' | 'resolved',
    escalated_to: conv.escalated_to as string | null,
    escalated_at: conv.escalated_at as string | null,
    created_at: conv.created_at as string,
  }

  const messageList = (messages ?? []).map((m) => ({
    id: m.id as string,
    role: m.role as 'patient' | 'agent' | 'staff',
    content: m.content as string,
    message_type: m.message_type as string,
    created_at: m.created_at as string,
  }))

  const canWrite = session.permissions.conversations?.write ?? false
  const staffName = session.fullName.split(' ')[0] ?? session.fullName

  return (
    <div style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
      <ConversationChat
        conversation={conversation}
        initialMessages={messageList}
        canWrite={canWrite}
        staffName={staffName}
        nextAppointment={nextAppointment}
      />
    </div>
  )
}
