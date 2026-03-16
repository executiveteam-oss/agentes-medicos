'use client'

// ============================================================
// PÁGINA ASISTENTE IA — Chat interno para el staff
// Ruta: /dashboard/asistente
//
// El asistente puede:
// - Consultar citas, stats, lista de espera, cartera
// - Proponer acciones (recordatorios, cambios de estado)
//   que el staff debe confirmar antes de ejecutar
// ============================================================

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, AlertTriangle } from 'lucide-react'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'

interface PendingAction {
  toolName: string
  params: Record<string, unknown>
  description: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export default function AsistentePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: '¡Hola! Soy el asistente interno del consultorio. Puedo ayudarte con información sobre citas, pacientes, no-shows, cartera y lista de espera. ¿En qué te puedo ayudar?',
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading, pendingAction])

  const sendMessage = async (userText: string, confirmedAction?: PendingAction) => {
    if (!userText.trim() && !confirmedAction) return

    setError(null)
    setIsLoading(true)

    const newUserMessage: ChatMessage = { role: 'user', content: userText }
    const updatedMessages = confirmedAction
      ? messages
      : [...messages, newUserMessage]

    if (!confirmedAction) setMessages(updatedMessages)

    try {
      const apiMessages: MessageParam[] = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch('/api/dashboard/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          confirmedAction: confirmedAction ?? null,
        }),
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error ?? 'Error del servidor')
      }

      const data = await res.json() as { reply: string; pendingAction: PendingAction | null }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.reply,
      }

      setMessages((prev) => [...prev, assistantMessage])
      setPendingAction(data.pendingAction ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    const text = input
    setInput('')
    sendMessage(text)
  }

  const handleConfirmAction = () => {
    if (!pendingAction) return
    const action = pendingAction
    setPendingAction(null)
    sendMessage(`Acción confirmada: ${action.description}`, action)
  }

  const handleRejectAction = () => {
    setPendingAction(null)
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: 'De acuerdo, cancelé la acción. ¿En qué más te puedo ayudar?' },
    ])
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-700 flex items-center justify-center">
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Asistente IA</h1>
            <p className="text-slate-500 text-xs">Consulta y gestiona tu consultorio con IA</p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto bg-slate-50 px-6 py-6 space-y-5">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 bg-blue-700 rounded-full flex items-center justify-center shrink-0 mt-1">
                <Bot size={14} className="text-white" />
              </div>
            )}
            <div
              className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-700 text-white rounded-br-sm'
                  : 'bg-white text-slate-700 border border-slate-200 shadow-sm rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center shrink-0 mt-1">
                <User size={14} className="text-slate-600" />
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 bg-blue-700 rounded-full flex items-center justify-center shrink-0 mt-1">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center">
                <div className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Action confirmation dialog */}
        {pendingAction && !isLoading && (
          <div className="mx-auto max-w-md">
            <div className="bg-white border-2 border-amber-300 rounded-xl p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">Confirmación requerida</p>
                  <p className="text-slate-900 text-sm font-medium mb-1">El asistente quiere realizar una acción:</p>
                  <p className="text-amber-700 text-sm mb-4 bg-amber-50 rounded-lg px-3 py-2">{pendingAction.description}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleConfirmAction}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-colors"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={handleRejectAction}
                      className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium py-2 px-3 rounded-lg transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick suggestions */}
      {messages.length === 1 && (
        <div className="bg-white border-t border-slate-100 px-6 py-3">
          <p className="text-xs text-slate-400 mb-2">Sugerencias:</p>
          <div className="flex flex-wrap gap-2">
            {[
              '¿Cuántas citas hay hoy?',
              '¿Cuál es la tasa de no-show?',
              '¿Quién está en lista de espera?',
              '¿Cuánto hay en cartera?',
            ].map((sugg) => (
              <button
                key={sugg}
                onClick={() => { setInput(sugg) }}
                className="bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-600 text-xs px-3 py-1.5 rounded-full transition-colors"
              >
                {sugg}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <form onSubmit={handleSubmit} className="bg-white border-t border-slate-200 p-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading || !!pendingAction}
            placeholder={pendingAction ? 'Confirma o cancela la acción primero...' : 'Escribe tu pregunta...'}
            className="flex-1 bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition-all"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim() || !!pendingAction}
            className="bg-blue-700 hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed text-white p-3 rounded-xl transition-colors"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  )
}
