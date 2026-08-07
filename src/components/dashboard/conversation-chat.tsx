'use client'

// ============================================================
// ConversationChat v2 — Chat + Context panel + Realtime
// ============================================================

import { useState, useRef, useEffect, useTransition, useCallback } from 'react'
import { formatPhone } from '@/lib/utils/dates'
import { getInitials } from '@/lib/utils/ui-helpers'
import { sendStaffMessage, setConversationTriageState, returnConversationToAgent, getMessagesSince, takeOverConversation } from '@/app/actions/conversations'
import { PatientLabelsEditor } from '@/components/dashboard/patient-labels-editor'
import type { ClinicLabel } from '@/lib/labels/patient-labels'
import { resolveClaimState, type ClaimConfig, type ClaimRow } from '@/lib/rules/claim-logic'
import { useRealtimeConnection } from '@/hooks/use-realtime-connection'
import { RealtimeIndicator } from '@/components/dashboard/realtime-indicator'
import { formatTimeUI, formatDaySeparatorUI, isDifferentDayUI, formatUI } from '@/lib/utils/format-time-ui'
import { RelativeTime } from '@/components/ui/relative-time'
import Link from 'next/link'
import { ChevronLeft, Send, Info, Image, FileText, Mic, User, Calendar, AlertTriangle, X, Unlock } from 'lucide-react'

// ---- Types ----

interface Message {
  id: string
  role: 'patient' | 'agent' | 'staff'
  content: string
  message_type: string
  created_at: string
  sender_name?: string | null   // quién envió (solo staff); NULL en históricos → "Equipo"
  delivery_status?: 'failed' | null
  delivery_error?: string | null
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
  triage_state: 'atencion' | 'pendiente' | 'resuelta' | null
  escalated_to: string | null
  escalated_at: string | null
  escalation_reason: string | null
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
  claimConfig: ClaimConfig
  claim: ClaimRow
  myClinicUserId: string
  patientLabelIds: string[]
  labelCatalog: ClinicLabel[]
  canLabelWrite: boolean
}

// ---- Helpers ----
// Todo el formateo de tiempo pasa por format-time-ui: fija America/Bogota
// explícitamente y da el MISMO string en el servidor (UTC) y en el navegador.
// Con `format()` de date-fns a secas, cada hora de mensaje se renderizaba con 5
// horas de diferencia entre los dos lados → mismatch de hidratación (React
// #418). Ver el encabezado de src/lib/utils/format-time-ui.ts.

function formatTime(dateStr: string): string {
  return formatTimeUI(dateStr)
}

function formatDateSep(dateStr: string): string {
  return formatDaySeparatorUI(dateStr)
}

function needsDateSep(current: string, previous: string | null): boolean {
  if (!previous) return true
  return isDifferentDayUI(current, previous)
}



// ---- Main Component ----

export function ConversationChat({ conversation, initialMessages, canWrite, staffName, nextAppointment, claimConfig, claim: initialClaim, myClinicUserId, patientLabelIds, labelCatalog, canLabelWrite }: Props) {
  const [messages, setMessages] = useState(initialMessages)
  const [status, setStatus] = useState(conversation.status)
  const [triage, setTriage] = useState(conversation.triage_state)
  // Estado de triage derivado: resuelta/atención salen del status; pendiente se persiste.
  const triageState: 'atencion' | 'pendiente' | 'resuelta' =
    status === 'resolved' ? 'resuelta' : triage === 'pendiente' ? 'pendiente' : 'atencion'
  const [newMessage, setNewMessage] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [showContext, setShowContext] = useState(false)
  // Devolver al agente (Etapa 3): crisis abre modal (checkbox + motivo obligatorio);
  // los demás motivos van con confirmación liviana.
  const [showCrisisReturn, setShowCrisisReturn] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [crisisConfirmed, setCrisisConfirmed] = useState(false)
  const [claim, setClaim] = useState<ClaimRow>(initialClaim)
  const [justTookOver, setJustTookOver] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Abrir la conversación NO reclama nada (antes auto-claim al abrir = reclamaba
  // por MIRAR). Ahora el claim se toma con acción explícita: "Atender yo" o
  // escribir un mensaje.

  // Realtime: listen for new messages
  // Backfill del detalle: al (re)conectar, traer los mensajes posteriores al
  // último que tenemos (recupera lo perdido durante una caída). Ref para no
  // recrear el callback en cada mensaje.
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])
  const backfill = useCallback(async () => {
    const real = messagesRef.current.filter((m) => !m.id.startsWith('temp-'))
    const since = real.length ? real[real.length - 1].created_at : new Date(0).toISOString()
    const r = await getMessagesSince(conversation.id, since)
    if (!r.ok || !r.messages?.length) return
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id))
      const add: Message[] = (r.messages ?? [])
        .filter((m) => !ids.has(m.id))
        .map((m) => ({ ...m, role: m.role as Message['role'] }))
      if (!add.length) return prev
      return [...prev.filter((m) => !m.id.startsWith('temp-')), ...add]
    })
  }, [conversation.id])

  // Realtime robusto: mensajes nuevos + status/claim, con indicador de "sin
  // conexión" y backfill al reconectar (ver use-realtime-connection).
  const { connected } = useRealtimeConnection({
    channelName: `chat-${conversation.id}`,
    deps: [conversation.id],
    onResync: backfill,
    bind: (channel) =>
      channel
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
              sender_name: (newMsg.sender_name as string | null) ?? null,
            }
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev
              const filtered = prev.filter((m) => !m.id.startsWith('temp-'))
              return [...filtered, msg]
            })
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversation.id}` },
          (payload) => {
            const row = payload.new as Record<string, unknown>
            const newStatus = row.status as string
            if (newStatus) setStatus(newStatus as typeof status)
            setClaim({
              claimed_by: (row.claimed_by as string | null) ?? null,
              claimed_by_name: (row.claimed_by_name as string | null) ?? null,
              claimed_at: (row.claimed_at as string | null) ?? null,
            })
          },
        ),
  })

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
      sender_name: staffName,   // lo envío yo → mi nombre
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
        // Escribir = atender: el backend pausó el agente + me reclamó. Reflejarlo
        // en el acto (NO cambio silencioso). Si venía con el agente → banner.
        setStatus('escalated'); setTriage('atencion')
        setClaim({ claimed_by: myClinicUserId, claimed_by_name: staffName, claimed_at: new Date().toISOString() })
        if (result.tookOver) setJustTookOver(true)
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

  // Eje A — ATENDER YO: pausa el agente + me reclama + triage Atención.
  function handleTakeOver() {
    startTransition(async () => {
      const r = await takeOverConversation(conversation.id)
      if (r.ok) {
        setStatus('escalated'); setTriage('atencion')
        setClaim({ claimed_by: myClinicUserId, claimed_by_name: staffName, claimed_at: new Date().toISOString() })
        showToastMsg('Ahora la estás atendiendo tú — el agente está en pausa')
      } else showToastMsg(r.error ?? 'Error')
    })
  }

  function handleTriage(next: 'atencion' | 'pendiente' | 'resuelta') {
    if (next === triageState) return
    startTransition(async () => {
      const r = await setConversationTriageState(conversation.id, next)
      if (r.ok) {
        setStatus(next === 'resuelta' ? 'resolved' : 'escalated')
        setTriage(next === 'pendiente' ? 'pendiente' : null)
        showToastMsg(next === 'atencion' ? 'En atención' : next === 'pendiente' ? 'Marcada pendiente' : 'Resuelta')
      } else showToastMsg(r.error ?? 'Error')
    })
  }

  // Devolver al agente. Crisis (escalation_reason==='crisis') → modal con
  // checkbox + motivo obligatorio. Otros motivos → confirm liviano.
  function handleReturnClick() {
    if (conversation.escalation_reason === 'crisis') {
      setReturnReason(''); setCrisisConfirmed(false); setShowCrisisReturn(true)
      return
    }
    if (!window.confirm('¿Devolver al agente? El bot va a responder el último mensaje del paciente.')) return
    runReturnToAgent()
  }

  function runReturnToAgent(reason?: string) {
    startTransition(async () => {
      const r = await returnConversationToAgent(conversation.id, reason)
      if (r.ok) {
        setStatus('active'); setTriage(null); setShowCrisisReturn(false)
        showToastMsg(
          r.escalatedAgain ? 'Devuelta, pero el agente volvió a escalar'
            : r.replied ? 'Devuelta al agente — respondió el último mensaje'
            : 'Devuelta al agente'
        )
      } else showToastMsg(r.error ?? 'Error')
    })
  }

  const assistanceRate = conversation.patient_total_appointments > 0
    ? Math.round(((conversation.patient_total_appointments - conversation.patient_no_show_count) / conversation.patient_total_appointments) * 100)
    : 100

  const claimState = resolveClaimState(claim, myClinicUserId, claimConfig.expiryMinutes, Date.now())
  const lockedByOther = claimConfig.enabled && claimConfig.mode === 'hard' && claimState.state === 'others'

  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden', fontFamily: 'var(--font-manrope), sans-serif' }}>
      {/* ===== Chat column ===== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <RealtimeIndicator connected={connected} />
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
            // En celular los grupos de botones (triage + eje A) no entran en la
            // misma fila que el nombre: ~480px de contenido que no encoge en una
            // pantalla de 390. Con wrap bajan a una segunda línea en vez de
            // desbordarse. En computador la fila entra y el wrap nunca dispara.
            flexWrap: 'wrap',
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
                  {' '}&middot; Cita <RelativeTime iso={nextAppointment.starts_at} fallbackPattern="EEE d MMM, h:mm a" />
                </span>
              )}
            </p>
            {conversation.patient_id && (
              <div style={{ marginTop: '6px' }}>
                <PatientLabelsEditor
                  patientId={conversation.patient_id}
                  patientLabelIds={patientLabelIds}
                  catalog={labelCatalog}
                  canWrite={canLabelWrite}
                />
              </div>
            )}
          </div>

          {/* Eje B — Triage: Atención / Pendiente / Resuelta. SIEMPRE visible, sin
              depender del status (nunca hay que escalar primero para triar). Un
              solo camino a Resuelta: setConversationTriageState. */}
          {canWrite && (
            <div className="max-lg:w-full" style={{ display: 'flex', background: 'var(--v2-bg-deeper)', borderRadius: '8px', padding: '2px', gap: '2px', flexShrink: 0 }}>
              {([['atencion', 'Atención'], ['pendiente', 'Pendiente'], ['resuelta', 'Resuelta']] as const).map(([k, label]) => {
                const on = triageState === k
                const c = k === 'atencion' ? ['var(--v2-amber-soft)', '#b07d00'] : k === 'pendiente' ? ['rgba(62,116,232,0.14)', '#3E74E8'] : ['var(--v2-green-soft)', 'var(--v2-green-deep)']
                return (
                  <button key={k} onClick={() => handleTriage(k)} disabled={isPending} className="v2-tap-seg" style={{
                    border: 'none', fontFamily: 'inherit', fontWeight: 700, borderRadius: '6px', cursor: isPending ? 'default' : 'pointer',
                    background: on ? c[0] : 'transparent', color: on ? c[1] : 'var(--v2-text-muted)',
                  }}>{label}</button>
                )
              })}
            </div>
          )}

          {/* Eje A — Quién responde. "Atender yo" pausa el agente + me reclama;
              "Que siga el agente" lo retoma + libera el claim. SIEMPRE accesible.

              INVARIANTE: en estado escalado "Que siga el agente" se muestra
              SIEMPRE, sin importar el claim. Son decisiones INDEPENDIENTES —
              quién la atiende (claim) no puede condicionar si se le puede
              devolver al agente. Gatearlo detrás del claim dejaba una
              conversación escalada que nadie tomó sin ninguna forma de
              devolvérsela al bot: había que reclamarla primero para poder
              soltarla.

              "Atender yo" se esconde SOLO cuando ya es mía: al lado del badge
              "La atiendes tú" es ruido, y su único efecto (refrescar el
              vencimiento del claim) es invisible — nadie aprieta un botón por
              algo que no ve. */}
          {canWrite && (
            <div className="max-lg:w-full" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              {status === 'escalated' ? (
                <>
                  {claimState.state === 'mine' && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--v2-green-deep)', background: 'var(--v2-green-soft)', padding: '4px 8px', borderRadius: '6px', whiteSpace: 'nowrap' }}>✋ La atiendes tú</span>
                  )}
                  {claimState.state === 'others' && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#b07d00', background: 'var(--v2-amber-soft)', padding: '4px 8px', borderRadius: '6px', whiteSpace: 'nowrap' }}>🙋 {claimState.byName}</span>
                  )}
                  {claimState.state !== 'mine' && (
                    <button onClick={handleTakeOver} disabled={isPending} className="btn-v2-primary v2-tap max-lg:flex-1" style={{ whiteSpace: 'nowrap' }}>✋ Atender yo</button>
                  )}
                  <button onClick={handleReturnClick} disabled={isPending} className="v2-tap max-lg:flex-1" style={{ fontWeight: 600, fontFamily: 'inherit', borderRadius: 'var(--v2-radius)', border: '1px solid var(--v2-border-soft)', background: 'var(--v2-bg-card)', color: 'var(--v2-text)', cursor: isPending ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>🤖 Que siga el agente</button>
                </>
              ) : status === 'active' ? (
                <>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-text-subtle)', whiteSpace: 'nowrap' }}>🤖 El agente responde</span>
                  <button onClick={handleTakeOver} disabled={isPending} className="btn-v2-primary v2-tap max-lg:flex-1" style={{ whiteSpace: 'nowrap' }}>✋ Atender yo</button>
                </>
              ) : (
                <button onClick={handleTakeOver} disabled={isPending} className="btn-v2-primary v2-tap max-lg:flex-1" style={{ whiteSpace: 'nowrap' }}>✋ Atender yo</button>
              )}
              <button
                onClick={() => setShowContext(!showContext)}
                className="lg:hidden"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '6px' }}
              >
                <Info size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Status banner */}
        {status === 'escalated' && (
          <div style={{ padding: '8px 18px', background: 'var(--v2-amber-soft)', borderBottom: '1px solid rgba(255,184,69,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={14} style={{ color: '#b07d00' }} />
            <p style={{ fontSize: '12px', color: '#b07d00', fontWeight: 500 }}>
              Esta conversación está escalada. El agente no responde hasta que alguien la atienda o se la devuelva.
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
            minWidth: 0,
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
                            {msg.role === 'agent' ? '🤖 Omu' : msg.role === 'staff' ? (msg.sender_name ? msg.sender_name.split(' ')[0] : 'Equipo') : 'Paciente'}
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
                          {msg.delivery_status === 'failed' && (
                            <p style={{ fontSize: '11px', marginTop: '4px', color: 'var(--v2-red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                              ⚠ No entregado{msg.delivery_error ? ` — ${msg.delivery_error}` : ''}
                            </p>
                          )}
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

        {/* Take-over VISIBLE (punto 2): apenas escribís desde una conversación
            que estaba con el agente, se ve que el bot quedó en pausa + "Que siga
            el agente" acá mismo. Un cambio de estado silencioso es cómo se deja
            al bot mudo sin darse cuenta. */}
        {justTookOver && (
          <div style={{ padding: '10px 18px', background: 'var(--v2-green-soft)', borderTop: '1px solid var(--v2-border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--v2-green-deep)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Unlock size={13} /> Ahora la estás atendiendo tú — el agente está en pausa
            </span>
            <button
              onClick={handleReturnClick}
              disabled={isPending}
              className="v2-tap"
              style={{ fontWeight: 700, color: 'var(--v2-green-deep)', background: 'none', border: '1px solid var(--v2-green-deep)', borderRadius: '6px', cursor: isPending ? 'not-allowed' : 'pointer' }}
            >
              🤖 Que siga el agente
            </button>
          </div>
        )}

        {/* Input */}
        {canWrite && (
          <div style={{ padding: '12px 18px', background: 'var(--v2-bg-card)', borderTop: '1px solid var(--v2-border-soft)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={lockedByOther ? `${claimState.byName ?? 'Otro usuario'} está atendiendo esta conversación` : 'Escribe un mensaje...'}
                rows={1}
                disabled={lockedByOther}
                className="input-v2"
                style={{ flex: 1, resize: 'none', minHeight: '42px', maxHeight: '120px' }}
              />
              <button
                onClick={handleSend}
                disabled={isPending || !newMessage.trim() || lockedByOther}
                style={{
                  width: '42px', height: '42px', borderRadius: 'var(--v2-radius)', border: 'none',
                  background: isPending || !newMessage.trim() || lockedByOther ? 'var(--v2-bg-deeper)' : 'linear-gradient(135deg, var(--v2-primary), var(--v2-primary-deep))',
                  color: '#fff', cursor: isPending || !newMessage.trim() || lockedByOther ? 'not-allowed' : 'pointer',
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
                  <RelativeTime iso={nextAppointment.starts_at} fallbackPattern="EEE d MMM, h:mm a" />
                </p>
                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--v2-text)' }}>
                  {nextAppointment.reason ?? 'Consulta'}
                </p>
                <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>
                  {formatUI(nextAppointment.starts_at, "EEEE d MMM · h:mm a")}
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
                <StatRow label="Paciente desde" value={formatUI(conversation.patient_created_at, "MMM yyyy")} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Devolver al agente — modal de CRISIS (fricción alta): checkbox + motivo
          obligatorio. Los otros motivos usan confirm liviano, sin este modal. */}
      {showCrisisReturn && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={() => !isPending && setShowCrisisReturn(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', boxShadow: 'var(--v2-shadow-lg)', padding: '20px', maxWidth: '420px', width: '100%', fontFamily: 'var(--font-manrope), sans-serif' }}>
            <p style={{ fontSize: '15px', fontWeight: 800, color: 'var(--v2-text)', marginBottom: '6px' }}>🆘 Devolver una conversación de crisis</p>
            <p style={{ fontSize: '12.5px', color: 'var(--v2-text-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
              Esta conversación se escaló por una posible crisis. Devolverla al agente hace que el bot responda el último mensaje. La alerta 🆘 NO se borra. Confirmá que ya fue atendida.
            </p>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: 'var(--v2-text)', marginBottom: '12px', cursor: 'pointer' }}>
              <input type="checkbox" checked={crisisConfirmed} onChange={(e) => setCrisisConfirmed(e.target.checked)} style={{ marginTop: '2px' }} />
              <span>Confirmo que la situación de crisis fue atendida por una persona.</span>
            </label>
            <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Motivo (obligatorio): qué se hizo / por qué es seguro devolver…"
              className="input-v2" style={{ width: '100%', minHeight: '72px', resize: 'vertical', marginBottom: '14px' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowCrisisReturn(false)} disabled={isPending} className="btn-v2-ghost" style={{ fontSize: '13px', padding: '8px 14px' }}>Cancelar</button>
              <button
                onClick={() => runReturnToAgent(returnReason)}
                disabled={isPending || !crisisConfirmed || !returnReason.trim()}
                className="btn-v2-primary"
                style={{ fontSize: '13px', padding: '8px 14px', opacity: (isPending || !crisisConfirmed || !returnReason.trim()) ? 0.5 : 1 }}
              >
                Devolver al agente
              </button>
            </div>
          </div>
        </div>
      )}

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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}>{value}</span>
    </div>
  )
}
