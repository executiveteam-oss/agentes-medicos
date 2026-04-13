'use client'

// ============================================================
// ConversationChat — Vista de chat estilo WhatsApp
// Muestra burbujas de mensajes y permite enviar como staff
// ============================================================

import { useState, useRef, useEffect, useTransition } from 'react'
import { sendStaffMessage, updateConversationStatus, reopenConversation } from '@/app/actions/conversations'
import { format, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import Link from 'next/link'
import type { ConversationStatus } from '@/types/database'

interface Message {
  id: string
  role: 'patient' | 'agent' | 'staff'
  content: string
  message_type: string
  created_at: string
}

interface ConversationInfo {
  id: string
  patient_name: string
  patient_phone: string
  status: ConversationStatus
  escalated_to: string | null
  escalated_at: string | null
  created_at: string
}

interface Props {
  conversation: ConversationInfo
  initialMessages: Message[]
  canWrite: boolean
}

const STATUS_CONFIG: Record<ConversationStatus, { label: string; class: string }> = {
  active: { label: 'Activa', class: 'badge-green' },
  escalated: { label: 'Escalada', class: 'badge-red' },
  resolved: { label: 'Resuelta', class: 'badge-slate' },
}

const ROLE_CONFIG: Record<string, { label: string; bubbleClass: string; align: 'left' | 'right' }> = {
  patient: {
    label: 'Paciente',
    bubbleClass: 'bg-white border border-slate-200 text-slate-800',
    align: 'left',
  },
  agent: {
    label: 'Agente IA',
    bubbleClass: 'bg-emerald-100 text-slate-800',
    align: 'right',
  },
  staff: {
    label: 'Staff',
    bubbleClass: 'bg-blue-100 text-slate-800',
    align: 'right',
  },
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr)
  return format(date, 'h:mm a')
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr)
  if (isToday(date)) return 'Hoy'
  if (isYesterday(date)) return 'Ayer'
  return format(date, "EEEE d 'de' MMMM", { locale: es })
}

function shouldShowDateSeparator(current: string, previous: string | null): boolean {
  if (!previous) return true
  const a = new Date(current).toDateString()
  const b = new Date(previous).toDateString()
  return a !== b
}

export function ConversationChat({ conversation, initialMessages, canWrite }: Props) {
  const [messages, setMessages] = useState(initialMessages)
  const [status, setStatus] = useState(conversation.status)
  const [newMessage, setNewMessage] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll al fondo cuando llegan nuevos mensajes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleSend() {
    const text = newMessage.trim()
    if (!text || isPending) return

    // Agregar mensaje optimista
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
        // Reemplazar mensaje optimista con el real
        const msg = result.message
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? { ...msg, role: msg.role as Message['role'] } : m))
        )
        showToast('Mensaje enviado')
      } else {
        // Quitar mensaje optimista si falló
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
        showToast(result.error ?? 'Error enviando mensaje')
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

  function handleResolve() {
    startTransition(async () => {
      const result = await updateConversationStatus(conversation.id, 'resolved')
      if (result.ok) {
        setStatus('resolved')
        showToast('Conversación marcada como resuelta')
      } else {
        showToast(result.error ?? 'Error')
      }
    })
  }

  function handleEscalate() {
    startTransition(async () => {
      const result = await updateConversationStatus(conversation.id, 'escalated', 'doctor')
      if (result.ok) {
        setStatus('escalated')
        showToast('Conversación escalada al médico')
      } else {
        showToast(result.error ?? 'Error')
      }
    })
  }

  function handleReopen() {
    startTransition(async () => {
      const result = await reopenConversation(conversation.id)
      if (result.ok) {
        setStatus('active')
        showToast('Conversación reabierta')
      } else {
        showToast(result.error ?? 'Error')
      }
    })
  }

  const statusInfo = STATUS_CONFIG[status]
  const phoneDisplay = conversation.patient_phone
    .replace('+57', '')
    .replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4 shrink-0">
        <Link
          href="/dashboard/conversations"
          className="text-slate-400 hover:text-slate-600 transition-colors p-1"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>

        {/* Info del paciente */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-slate-900 truncate">{conversation.patient_name}</h1>
            <span className={`badge ${statusInfo.class} text-[10px]`}>{statusInfo.label}</span>
          </div>
          <p className="text-xs text-slate-400">{phoneDisplay}</p>
        </div>

        {/* Acciones */}
        {canWrite && (
          <div className="flex items-center gap-2 shrink-0">
            {status === 'active' && (
              <>
                <button
                  onClick={handleResolve}
                  disabled={isPending}
                  className="text-xs font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Marcar resuelta
                </button>
                <button
                  onClick={handleEscalate}
                  disabled={isPending}
                  className="text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Escalar a médico
                </button>
              </>
            )}
            {(status === 'resolved' || status === 'escalated') && (
              <div className="flex flex-col items-end gap-0.5">
                <button
                  onClick={handleReopen}
                  disabled={isPending}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Reabrir y pasar al agente
                </button>
                <span className="text-[10px] text-slate-400">El agente responderá al próximo mensaje</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Escalation banner */}
      {status === 'escalated' && (
        <div className="bg-red-50 border-b border-red-100 px-6 py-2">
          <p className="text-xs text-red-700">
            ⚠️ Conversación escalada{conversation.escalated_to ? ` a ${conversation.escalated_to}` : ''}.
            El agente IA no responde hasta que se reabra.
          </p>
        </div>
      )}
      {status === 'resolved' && (
        <div className="bg-slate-50 border-b border-slate-100 px-6 py-2">
          <p className="text-xs text-slate-500">
            ✅ Conversación marcada como resuelta
          </p>
        </div>
      )}

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-6 py-4 bg-slate-50 space-y-1">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-400">Sin mensajes</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const roleConfig = ROLE_CONFIG[msg.role] ?? ROLE_CONFIG.patient
            const showDate = shouldShowDateSeparator(
              msg.created_at,
              idx > 0 ? messages[idx - 1].created_at : null
            )
            const isRight = roleConfig.align === 'right'

            return (
              <div key={msg.id}>
                {/* Separador de fecha */}
                {showDate && (
                  <div className="flex justify-center my-4">
                    <span className="bg-white text-slate-400 text-xs px-3 py-1 rounded-full shadow-sm border border-slate-100">
                      {formatDateSeparator(msg.created_at)}
                    </span>
                  </div>
                )}

                {/* Burbuja */}
                <div className={`flex mb-1.5 ${isRight ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] ${isRight ? 'items-end' : 'items-start'}`}>
                    {/* Label del rol */}
                    {(idx === 0 || messages[idx - 1].role !== msg.role) && (
                      <p className={`text-[10px] font-medium mb-0.5 px-1 ${
                        msg.role === 'patient'
                          ? 'text-slate-400'
                          : msg.role === 'staff'
                            ? 'text-blue-500 text-right'
                            : 'text-emerald-600 text-right'
                      }`}>
                        {roleConfig.label}
                      </p>
                    )}
                    <div className={`rounded-2xl px-3.5 py-2 ${roleConfig.bubbleClass} ${
                      isRight ? 'rounded-tr-md' : 'rounded-tl-md'
                    }`}>
                      {msg.message_type !== 'text' && (
                        <p className="text-xs text-slate-400 italic mb-1">
                          [{msg.message_type === 'image' ? 'Imagen' : msg.message_type === 'document' ? 'Documento' : msg.message_type === 'audio' ? 'Audio' : msg.message_type}]
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                      <p className={`text-[10px] mt-1 ${
                        msg.role === 'patient' ? 'text-slate-400' : 'text-slate-400'
                      } ${isRight ? 'text-right' : ''}`}>
                        {formatMessageTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input de mensaje */}
      {canWrite && (
        <div className="bg-white border-t border-slate-200 px-6 py-3 shrink-0">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe un mensaje como staff..."
                rows={1}
                className="input-field py-2.5 pr-4 text-sm resize-none max-h-32"
                style={{ minHeight: '42px' }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={isPending || !newMessage.trim()}
              className="btn-primary py-2.5 px-4 shrink-0 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Enter para enviar, Shift+Enter para nueva línea
          </p>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
