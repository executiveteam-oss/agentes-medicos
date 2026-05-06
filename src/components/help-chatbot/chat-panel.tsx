'use client'

// ============================================================
// ChatPanel — expanded help chatbot panel
// ============================================================

import { useRef, useEffect, useState } from 'react'
import { X, Trash2, Send } from 'lucide-react'
import { useChatbot } from './provider'
import { MessageBubble } from './message'

export function ChatPanel() {
  const { messages, isOpen, isLoading, sessionId, close, clearMessages, addUserMessage, appendToLastAssistant, addToolUse, finishStream, setError } = useChatbot()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  async function handleSend() {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    addUserMessage(text)

    // Build messages array for API (all messages including new one)
    const apiMessages = [
      ...messages.filter((m) => !m.isStreaming).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: text },
    ]

    try {
      const res = await fetch('/api/chatbot/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, sessionId }),
      })

      if (res.status === 401) { setError('Tu sesión expiró. Recarga la página.'); return }
      if (res.status === 429) {
        const body = await res.json()
        setError(body.error ?? 'Demasiadas preguntas. Espera un momento.')
        return
      }
      if (!res.ok) { setError('Error del servicio de ayuda. Intenta de nuevo.'); return }

      const reader = res.body?.getReader()
      if (!reader) { setError('Error de conexion.'); return }

      const decoder = new TextDecoder()
      let buffer = ''
      let newSessionId: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'text') appendToLastAssistant(data.content)
            else if (data.type === 'tool_use') addToolUse(data.tool, data.input)
            else if (data.type === 'done') newSessionId = data.sessionId ?? null
            else if (data.type === 'error') { setError(data.message); return }
          } catch { /* skip malformed SSE lines */ }
        }
      }

      finishStream(newSessionId)
    } catch {
      setError('No se pudo conectar con el servicio de ayuda.')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Mobile overlay */}
      <div className="sm:hidden fixed inset-0 bg-black/30 z-[44]" onClick={close} />

      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '380px',
          height: '540px',
          zIndex: 45,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--v2-bg)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-xl)',
          boxShadow: 'var(--v2-shadow-lg)',
          overflow: 'hidden',
          fontFamily: 'var(--font-manrope), sans-serif',
        }}
        className="max-sm:!inset-0 max-sm:!w-auto max-sm:!h-auto max-sm:!rounded-none max-sm:!bottom-0 max-sm:!right-0"
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px', fontFamily: "'Instrument Serif', serif", fontStyle: 'italic' }}>o</span>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>Omu</p>
            <p style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.7)' }}>Tu guia de Omuwan</p>
          </div>
          {messages.length > 0 && (
            <button onClick={clearMessages} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', padding: '4px' }} title="Limpiar conversacion">
              <Trash2 size={16} />
            </button>
          )}
          <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <span style={{ color: '#fff', fontSize: '22px', fontFamily: "'Instrument Serif', serif", fontStyle: 'italic' }}>o</span>
              </div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>¡Hola! Soy Omu</p>
              <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '4px', lineHeight: 1.5 }}>
                Preguntame como configurar tu clinica, usar el agente, o encontrar cualquier seccion de Omuwan.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--v2-border-soft)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Preguntame sobre Omuwan..."
              rows={1}
              disabled={isLoading}
              style={{
                flex: 1,
                resize: 'none',
                minHeight: '38px',
                maxHeight: '80px',
                padding: '9px 12px',
                border: '1.5px solid var(--v2-border)',
                borderRadius: 'var(--v2-radius)',
                fontSize: '13px',
                color: 'var(--v2-text)',
                background: 'var(--v2-bg-card)',
                fontFamily: 'var(--font-manrope), sans-serif',
                outline: 'none',
              }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--v2-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--v2-primary-soft)' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--v2-border)'; e.target.style.boxShadow = 'none' }}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                border: 'none',
                background: isLoading || !input.trim() ? 'var(--v2-bg-deeper)' : 'linear-gradient(135deg, var(--v2-primary), var(--v2-primary-deep))',
                color: '#fff',
                cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: input.trim() ? '0 2px 6px rgba(107,91,255,0.3)' : 'none',
              }}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
