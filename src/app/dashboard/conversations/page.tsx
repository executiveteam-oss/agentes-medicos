// ============================================================
// CONVERSACIONES — Lista de chats del agente IA (v2)
// Ruta: /dashboard/conversations
// ============================================================

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ConversationsPanel } from '@/components/dashboard/conversations-panel'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ConversationsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard')

  if (!session.permissions.conversations?.read) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
        <div className="card-v2" style={{ padding: '48px', textAlign: 'center', maxWidth: '400px' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔒</p>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--v2-text)' }}>No tienes permiso para ver conversaciones</p>
        </div>
      </div>
    )
  }

  // ---- Single optimized query: conversations + patient + last message ----
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select(`
      id, status, last_message_at, whatsapp_phone,
      patients(id, name, phone, eps, no_show_count, total_appointments),
      messages(id, content, role, created_at)
    `)
    .eq('clinic_id', session.clinicId)
    .order('last_message_at', { ascending: false })
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(200)

  // Map to entries with last message extracted from joined messages
  const entries = (conversations ?? []).map((conv) => {
    const patient = conv.patients as unknown as { id: string; name: string; phone: string; eps: string | null; no_show_count: number; total_appointments: number } | null
    const msgs = conv.messages as unknown as { id: string; content: string; role: string; created_at: string }[] | null
    const lastMsg = msgs?.[0] ?? null
    const msgCount = msgs?.length ?? 0

    return {
      id: conv.id as string,
      patient_id: patient?.id ?? null,
      patient_name: patient?.name ?? 'Desconocido',
      patient_phone: patient?.phone ?? (conv.whatsapp_phone as string),
      patient_eps: patient?.eps ?? null,
      status: conv.status as 'active' | 'escalated' | 'resolved',
      last_message_at: conv.last_message_at as string,
      last_message_preview: lastMsg
        ? lastMsg.content.length > 80 ? lastMsg.content.slice(0, 80) + '...' : lastMsg.content
        : '',
      last_message_role: lastMsg?.role ?? '',
      message_count: msgCount,
    }
  })

  // Sort: escalated first, then by date
  entries.sort((a, b) => {
    if (a.status === 'escalated' && b.status !== 'escalated') return -1
    if (b.status === 'escalated' && a.status !== 'escalated') return 1
    return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  })

  const counts = {
    all: entries.length,
    active: entries.filter((e) => e.status === 'active').length,
    escalated: entries.filter((e) => e.status === 'escalated').length,
    resolved: entries.filter((e) => e.status === 'resolved').length,
  }

  // Today's agent message count
  const now = new Date()
  const todayStart = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  todayStart.setHours(0, 0, 0, 0)
  const todayStartISO = new Date(todayStart.getTime() + 5 * 60 * 60 * 1000).toISOString()
  const { count: agentMsgToday } = await supabaseAdmin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'agent')
    .gte('created_at', todayStartISO)

  // Escalation phone check
  const { data: clinicEsc } = await supabaseAdmin
    .from('clinics')
    .select('escalation_contact_phone')
    .eq('id', session.clinicId)
    .maybeSingle()
  const hasEscalationPhone = !!((clinicEsc as Record<string, unknown> | null)?.escalation_contact_phone as string | null)?.trim()

  // Bloque 4 — count de autorizaciones pendientes para el acceso visible.
  // Solo carga si el usuario tiene authorizations.review (para no exponer
  // info sensible a quien no debe verla).
  let pendingAuthsCount = 0
  if (session.authorizationsReview) {
    const { count } = await supabaseAdmin
      .from('conversation_media')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', session.clinicId)
      .eq('context', 'authorization')
      .is('reviewed_at', null)
    pendingAuthsCount = count ?? 0
  }

  return (
    <div className="space-y-6">
      {/* Bloque 4 — acceso visible a la vista de autorizaciones pendientes.
          Solo visible para usuarios con authorizations.review (Admin,
          Coordinadora, Secretaria por default). */}
      {session.authorizationsReview && (
        <Link
          href="/dashboard/conversations/autorizaciones"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '14px 18px',
            borderRadius: 'var(--v2-radius)',
            background: pendingAuthsCount > 0 ? 'var(--v2-amber-soft)' : 'var(--v2-bg-card)',
            border: `1px solid ${pendingAuthsCount > 0 ? 'rgba(255, 184, 69, 0.4)' : 'var(--v2-border-soft)'}`,
            fontFamily: 'var(--font-manrope), sans-serif',
            textDecoration: 'none',
            color: 'inherit',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <ShieldCheck size={20} style={{ color: pendingAuthsCount > 0 ? '#b07d00' : 'var(--v2-text-muted)' }} />
            <div>
              <p style={{ fontSize: '13.5px', fontWeight: 700, color: pendingAuthsCount > 0 ? '#b07d00' : 'var(--v2-text)' }}>
                🛡 Autorizaciones direccionadas
              </p>
              <p style={{ fontSize: '12px', color: pendingAuthsCount > 0 ? '#b07d00' : 'var(--v2-text-muted)', opacity: 0.85, marginTop: '2px' }}>
                {pendingAuthsCount > 0
                  ? `${pendingAuthsCount} pendiente${pendingAuthsCount === 1 ? '' : 's'} de revisión`
                  : 'Sin autorizaciones pendientes'}
              </p>
            </div>
          </div>
          {pendingAuthsCount > 0 && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '999px',
                background: '#b07d00',
                color: '#fff',
              }}
            >
              {pendingAuthsCount}
            </span>
          )}
        </Link>
      )}

      {/* Escalation warning */}
      {!hasEscalationPhone && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '14px 18px',
            borderRadius: 'var(--v2-radius)',
            background: 'var(--v2-amber-soft)',
            border: '1px solid rgba(255, 184, 69, 0.3)',
            fontFamily: 'var(--font-manrope), sans-serif',
          }}
        >
          <AlertTriangle size={18} style={{ color: '#b07d00', flexShrink: 0, marginTop: '1px' }} />
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#b07d00' }}>
              Configura el teléfono de escalamiento
            </p>
            <p style={{ fontSize: '12px', color: '#b07d00', opacity: 0.8, marginTop: '2px' }}>
              Para que el equipo reciba notificaciones de conversaciones que necesitan humano.{' '}
              <Link href="/dashboard/settings/clinic" style={{ fontWeight: 700, textDecoration: 'underline' }}>
                Configurar →
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
        <div>
          <h1
            className="text-2xl sm:text-3xl"
            style={{ fontWeight: 800, fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)', letterSpacing: '-0.02em' }}
          >
            Tus{' '}
            <span
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: 'italic',
                fontWeight: 400,
                background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              conversaciones
            </span>
          </h1>
          <p style={{ fontSize: '13.5px', color: 'var(--v2-text-muted)', marginTop: '4px', fontFamily: 'var(--font-manrope), sans-serif' }}>
            {agentMsgToday ?? 0} mensajes hoy &middot; {counts.active} activas
            {counts.escalated > 0 && (
              <span style={{ color: 'var(--v2-pink)', fontWeight: 600 }}> &middot; {counts.escalated} requieren tu atencion</span>
            )}
          </p>
        </div>

        {/* Agent status badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            borderRadius: 'var(--v2-radius)',
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
            boxShadow: 'var(--v2-shadow-sm)',
            fontFamily: 'var(--font-manrope), sans-serif',
          }}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--v2-green)' }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--v2-green)' }} />
          </span>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)' }}>Agente activo</span>
          <span style={{ fontSize: '12px', color: 'var(--v2-text-subtle)' }}>&middot; Respuesta ~3s</span>
        </div>
      </div>

      {/* Panel */}
      <ConversationsPanel entries={entries} counts={counts} clinicId={session.clinicId} />
    </div>
  )
}
