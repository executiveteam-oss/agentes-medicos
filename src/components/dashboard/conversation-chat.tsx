'use client'

// ============================================================
// ConversationChat v2 — Chat + Context panel + Realtime
// ============================================================

import { useState, useRef, useEffect, useTransition } from 'react'
import { formatPhone } from '@/lib/utils/dates'
import { getInitials } from '@/lib/utils/ui-helpers'
import { sendStaffMessage, updateConversationStatus, reopenConversation } from '@/app/actions/conversations'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import Link from 'next/link'
import { ChevronLeft, Send, Info, MoreVertical, Image, FileText, Mic, User, Calendar, AlertTriangle, X } from 'lucide-react'

// ---- Types ----

interface Message {
  id: string
  role: 'patient' | 'agent' | 'staff'
  content: string
  message_type: string
  created_at: string
}

interface ConversationInfo {
  id: string
  patient_id: string | null
  patient_name: string
  patient_phone: string
  patient_eps: string | null
  patient_no_show_count: number
  patient_total_appointments: number
  patient_document_type: string | null
  patient_document_number: string | null
  patient_date_of_birth: string | null
  patient_created_at: string | null
  status: 'active' | 'escalated' | 'resolved'
  escalated_to: string | null
  escalated_at: string | null
  created_at: string
}

interface NextAppointment {
  id: string
  starts_at: string
  reason: string | null
  doctor_name: string | null
}

interface Props {
  conversation: ConversationInfo
  initialMessages: Message[]
  canWrite: boolean
  staffName: string
  nextAppointment: NextAppointment | null
}

// ---- Helpers ----

function formatTime(dateStr: string): string {
  return format(new Date(dateStr), 'h:mm a')
}

function formatDateSep(dateStr: string): string {
  const date = new Date(dateStr)
  if (isToday(date)) return 'HOY'
  if (isYesterday(date)) return 'AYER'
  return format(date, "EEE d MMM", { locale: es }).toUpperCase()
}

function needsDateSep(current: string, previous: string | null): boolean {
  if (!previous) return true
  return new Date(current).toDateString() !== new Date(previous).toDateString()
}



// ---- Main Component ----

export function ConversationChat({ conversation, initialMessages, canWrite, staffName, nextAppointment }: Props) {
  const [messages, setMessages] = useState(initialMessages)
  const [status, setStatus] = useState(conversation.status)
  const [newMessage, setNewMessage] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [showContext, setShowContext] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Realtime: listen for new messages
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`chat-${conversation.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const newMsg = payload.new as Record<string, unknown>
          const msg: Message = {
            id: newMsg.id as string,
            role: newMsg.role as Message['role'],
            content: newMsg.content as string,
            message_type: (newMsg.message_type as string) ?? 'text',
            created_at: newMsg.created_at as string,
          }
          // Avoid duplicates (optimistic messages)
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev
            // Remove temp messages that match this content
            const filtered = prev.filter((m) => !m.id.startsWith('temp-'))
            return [...filtered, msg]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversation.id}` },
        (payload) => {
          const newStatus = (payload.new as Record<string, unknown>).status as string
          if (newStatus) setStatus(newStatus as typeof status)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [conversation.id])

  function showToastMsg(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleSend() {
    const text = newMessage.trim()
    if (!text || isPending) return

    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'staff',
      content: text,
      message_type: 'text',
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])
    setNewMessage('')

    startTransition(async () => {
      const result = await sendStaffMessage(conversation.id, text)
      if (result.ok && result.message) {
        const msg = result.message
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? { ...msg, role: msg.role as Message['role'] } : m))
        )
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
        showToastMsg(result.error ?? 'Error enviando mensaje')
      }
    })

    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleAction(action: 'resolve' | 'escalate' | 'reopen') {
    setShowMenu(false)
    startTransition(async () => {
      if (action === 'resolve') {
        const r = await updateConversationStatus(conversation.id, 'resolved')
        if (r.ok) { setStatus('resolved'); showToastMsg('Conversacion resuelta') }
        else showToastMsg(r.error ?? 'Error')
      } else if (action === 'escalate') {
        const r = await updateConversationStatus(conversation.id, 'escalated', 'doctor')
        if (r.ok) { setStatus('escalated'); showToastMsg('Conversacion escalada') }
        else showToastMsg(r.error ?? 'Error')
      } else {
        const r = await reopenConversation(conversation.id)
        if (r.ok) { setStatus('active'); showToastMsg('Conversacion reabierta') }
        else showToastMsg(r.error ?? 'Error')
      }
    })
  }

  const assistanceRate = conversation.patient_total_appointments > 0
    ? Math.round(((conversation.patient_total_appointments - conversation.patient_no_show_count) / conversation.patient_total_appointments) * 100)
    : 100

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', fontFamily: 'var(--font-manrope), sans-serif' }}>
      {/* ===== Chat column ===== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 18px',
            background: 'var(--v2-bg-card)',
            borderBottom: '1px solid var(--v2-border-soft)',
            flexShrink: 0,
          }}
        >
          <Link href="/dashboard/conversations" style={{ color: 'var(--v2-text-subtle)', display: 'flex', textDecoration: 'none' }}>
            <ChevronLeft size={20} />
          </Link>

          <div
            style={{
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <span style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{getInitials(conversation.patient_name)}</span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>{conversation.patient_name}</p>
              <span
                style={{
                  fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px',
                  background: status === 'escalated' ? 'var(--v2-amber-soft)' : status === 'resolved' ? 'var(--v2-bg-deeper)' : 'var(--v2-green-soft)',
                  color: status === 'escalated' ? '#b07d00' : status === 'resolved' ? 'var(--v2-text-subtle)' : 'var(--v2-green-deep)',
                }}
              >
                {status === 'escalated' ? 'ESCALADA' : status === 'resolved' ? 'RESUELTA' : 'ACTIVA'}
              </span>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>
              {formatPhone(conversation.patient_phone)}
              {conversation.patient_eps && <span> &middot; {conversation.patient_eps}</span>}
              {nextAppointment && (
                <span style={{ color: 'var(--v2-pink)', fontWeight: 600 }}>
                  {' '}&middot; Cita {formatDistanceToNow(new Date(nextAppointment.starts_at), { addSuffix: true, locale: es })}
                </span>
              )}
            </p>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {status === 'escalated' && canWrite && (
              <button
                onClick={() => handleAction('reopen')}
                disabled={isPending}
                className="btn-v2-primary"
                style={{ fontSize: '11px', padding: '6px 12px' }}
              >
                Tomar control
              </button>
            )}
            <button
              onClick={() => setShowContext(!showContext)}
              className="lg:hidden"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '6px' }}
            >
              <Info size={18} />
            </button>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '6px' }}
              >
                <MoreVertical size={18} />
              </button>
              {showMenu && (
                <div
                  style={{
                    position: 'absolute', right: 0, top: '100%', zIndex: 10,
                    background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)',
                    borderRadius: 'var(--v2-radius)', boxShadow: 'var(--v2-shadow)', padding: '4px', minWidth: '180px',
                  }}
                >
                  {status === 'active' && (
                    <>
                      <MenuBtn onClick={() => handleAction('resolve')} label="Marcar resuelta" color="var(--v2-green-deep)" />
                      <MenuBtn onClick={() => handleAction('escalate')} label="Escalar a medico" color="var(--v2-red)" />
                    </>
                  )}
                  {(status === 'resolved' || status === 'escalated') && (
                    <MenuBtn onClick={() => handleAction('reopen')} label="Reabrir conversacion" color="var(--v2-primary)" />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status banner */}
        {status === 'escalated' && (
          <div style={{ padding: '8px 18px', background: 'var(--v2-amber-soft)', borderBottom: '1px solid rgba(255,184,69,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={14} style={{ color: '#b07d00' }} />
            <p style={{ fontSize: '12px', color: '#b07d00', fontWeight: 500 }}>
              El agente escalo esta conversacion{conversation.escalated_to ? ` a ${conversation.escalated_to}` : ''}. El agente no responde hasta reabrir.
            </p>
          </div>
        )}
        {status === 'resolved' && (
          <div style={{ padding: '8px 18px', background: 'var(--v2-bg-soft)', borderBottom: '1px solid var(--v2-border-soft)' }}>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)' }}>✅ Conversacion marcada como resuelta</p>
          </div>
        )}

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 18px',
            background: 'var(--v2-bg-tinted)',
            backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(107, 91, 255, 0.02), transparent 70%)',
          }}
        >
          {messages.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '28px', marginBottom: '8px' }}>💬</p>
                <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)' }}>Sin mensajes aun</p>
                <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>Omu esta esperando que el paciente escriba</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {messages.map((msg, idx) => {
                const isRight = msg.role !== 'patient'
                const showDate = needsDateSep(msg.created_at, idx > 0 ? messages[idx - 1].created_at : null)
                const showLabel = idx === 0 || messages[idx - 1].role !== msg.role

                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 8px' }}>
                        <span style={{
                          fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-jetbrains), monospace',
                          color: 'var(--v2-text-subtle)', background: 'var(--v2-bg-card)',
                          padding: '3px 12px', borderRadius: '999px', border: '1px solid var(--v2-border-soft)',
                        }}>
                          {formatDateSep(msg.created_at)}
                        </span>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: isRight ? 'flex-end' : 'flex-start', marginBottom: '2px' }}>
                      <div style={{ maxWidth: '75%' }}>
                        {showLabel && (
                          <p style={{
                            fontSize: '10px', fontWeight: 600, marginBottom: '2px', paddingLeft: '4px',
                            textAlign: isRight ? 'right' : 'left',
                            color: msg.role === 'agent' ? 'var(--v2-primary)' : msg.role === 'staff' ? 'var(--v2-pink)' : 'var(--v2-text-subtle)',
                          }}>
                            {msg.role === 'agent' ? '🤖 Omu' : msg.role === 'staff' ? staffName : 'Paciente'}
                          </p>
                        )}
                        <div
                          style={{
                            padding: '10px 14px',
                            borderRadius: '16px',
                            ...(msg.role === 'patient'
                              ? {
                                  background: 'var(--v2-bg-card)',
                                  border: '1px solid var(--v2-border-soft)',
                                  borderBottomLeftRadius: '4px',
                                  boxShadow: 'var(--v2-shadow-sm)',
                                }
                              : msg.role === 'agent'
                                ? {
                                    background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)',
                                    color: '#fff',
                                    borderBottomRightRadius: '4px',
                                    boxShadow: '0 2px 8px rgba(107, 91, 255, 0.2)',
                                  }
                                : {
                                    background: 'linear-gradient(135deg, var(--v2-pink), #FF8EC4)',
                                    color: '#fff',
                                    borderBottomRightRadius: '4px',
                                    boxShadow: '0 2px 8px rgba(255, 107, 170, 0.2)',
                                  }),
                          }}
                        >
                          {msg.message_type !== 'text' && (
                            <p style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {msg.message_type === 'image' ? <><Image size={12} /> Imagen</> : msg.message_type === 'document' ? <><FileText size={12} /> Documento</> : msg.message_type === 'audio' ? <><Mic size={12} /> Audio</> : `[${msg.message_type}]`}
                            </p>
                          )}
                          <p style={{ fontSize: '13.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</p>
                          <p style={{
                            fontSize: '10px', marginTop: '4px', opacity: 0.6,
                            textAlign: isRight ? 'right' : 'left',
                          }}>
                            {formatTime(msg.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {canWrite && (
          <div style={{ padding: '12px 18px', background: 'var(--v2-bg-card)', borderTop: '1px solid var(--v2-border-soft)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe un mensaje..."
                rows={1}
                className="input-v2"
                style={{ flex: 1, resize: 'none', minHeight: '42px', maxHeight: '120px' }}
              />
              <button
                onClick={handleSend}
                disabled={isPending || !newMessage.trim()}
                style={{
                  width: '42px', height: '42px', borderRadius: 'var(--v2-radius)', border: 'none',
                  background: isPending || !newMessage.trim() ? 'var(--v2-bg-deeper)' : 'linear-gradient(135deg, var(--v2-primary), var(--v2-primary-deep))',
                  color: '#fff', cursor: isPending || !newMessage.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  boxShadow: newMessage.trim() ? '0 2px 8px rgba(107, 91, 255, 0.3)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <Send size={16} />
              </button>
            </div>
            <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '6px' }}>
              Respondiendo como <span style={{ fontWeight: 600, color: 'var(--v2-pink)' }}>{staffName}</span> (humano) &middot; Enter enviar, Shift+Enter nueva linea
            </p>
          </div>
        )}
      </div>

      {/* ===== Context panel (desktop: always, mobile: drawer) ===== */}
      <div
        className={showContext ? 'fixed inset-0 z-40 flex justify-end lg:relative lg:inset-auto lg:z-auto' : 'hidden lg:block'}
        onClick={(e) => { if (e.target === e.currentTarget) setShowContext(false) }}
        style={showContext ? { background: 'rgba(0,0,0,0.3)' } : undefined}
      >
        <div
          style={{
            width: '320px',
            background: 'var(--v2-bg-card)',
            borderLeft: '1px solid var(--v2-border-soft)',
            overflowY: 'auto',
            height: '100%',
            flexShrink: 0,
          }}
        >
          {/* Mobile close */}
          <div className="lg:hidden" style={{ padding: '12px 16px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>Info del paciente</span>
            <button onClick={() => setShowContext(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)' }}>
              <X size={18} />
            </button>
          </div>

          {/* Patient info */}
          <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--v2-border-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div
                style={{
                  width: '44px', height: '44px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <span style={{ color: '#fff', fontSize: '14px', fontWeight: 700 }}>{getInitials(conversation.patient_name)}</span>
              </div>
              <div>
                <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--v2-text)' }}>{conversation.patient_name}</p>
                <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>{formatPhone(conversation.patient_phone)}</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {conversation.patient_eps && (
                <span className="tag-v2 tag-v2-primary">{conversation.patient_eps}</span>
              )}
              {conversation.patient_total_appointments >= 5 && (
                <span className="tag-v2 tag-v2-green">Paciente leal</span>
              )}
              {conversation.patient_no_show_count > 0 && (
                <span className="tag-v2 tag-v2-red">{conversation.patient_no_show_count} no-show{conversation.patient_no_show_count > 1 ? 's' : ''}</span>
              )}
            </div>
            {conversation.patient_id && (
              <Link
                href={`/dashboard/patients/${conversation.patient_id}`}
                style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-primary)', textDecoration: 'none', marginTop: '12px' }}
              >
                Ver perfil completo →
              </Link>
            )}
          </div>

          {/* Next appointment */}
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--v2-text-subtle)', marginBottom: '8px' }}>
              Proxima cita
            </p>
            {nextAppointment ? (
              <div style={{ padding: '14px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-primary-soft)', border: '1px solid var(--v2-primary-soft)' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--v2-primary)', textTransform: 'uppercase', marginBottom: '6px' }}>
                  {formatDistanceToNow(new Date(nextAppointment.starts_at), { addSuffix: true, locale: es })}
                </p>
                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--v2-text)' }}>
                  {nextAppointment.reason ?? 'Consulta'}
                </p>
                <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>
                  {format(new Date(nextAppointment.starts_at), "EEEE d MMM · h:mm a", { locale: es })}
                  {nextAppointment.doctor_name && ` · ${nextAppointment.doctor_name}`}
                </p>
              </div>
            ) : (
              <div style={{ padding: '14px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-bg-soft)', textAlign: 'center' }}>
                <Calendar size={18} style={{ color: 'var(--v2-text-subtle)', margin: '0 auto 6px' }} />
                <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)' }}>Sin citas proximas</p>
              </div>
            )}
          </div>

          {/* History stats */}
          <div style={{ padding: '0 16px 20px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--v2-text-subtle)', marginBottom: '8px' }}>
              Historial
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <StatRow label="Total citas" value={String(conversation.patient_total_appointments)} />
              <StatRow label="No-shows" value={String(conversation.patient_no_show_count)} />
              <StatRow label="Asistencia" value={`${assistanceRate}%`} />
              {conversation.patient_created_at && (
                <StatRow label="Paciente desde" value={format(new Date(conversation.patient_created_at), "MMM yyyy", { locale: es })} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 50,
            padding: '10px 18px', borderRadius: 'var(--v2-radius)',
            fontSize: '13px', fontWeight: 600, color: '#fff',
            background: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-lg)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

// ---- Sub-components ----

function MenuBtn({ onClick, label, color }: { onClick: () => void; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
        fontSize: '12.5px', fontWeight: 600, color, background: 'none', border: 'none',
        cursor: 'pointer', borderRadius: '6px', transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-bg-soft)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
    >
      {label}
    </button>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}>{value}</span>
    </div>
  )
}
