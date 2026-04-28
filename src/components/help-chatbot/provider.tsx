'use client'

// ============================================================
// HelpChatbotProvider — persists chatbot state across navigation
// ============================================================

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolUse?: { tool: string; input: Record<string, unknown> }
  isStreaming?: boolean
}

interface ChatbotState {
  isOpen: boolean
  messages: ChatMessage[]
  sessionId: string | null
  isLoading: boolean
}

interface ChatbotContextValue extends ChatbotState {
  toggle: () => void
  close: () => void
  addUserMessage: (content: string) => void
  appendToLastAssistant: (text: string) => void
  addToolUse: (tool: string, input: Record<string, unknown>) => void
  finishStream: (sessionId: string | null) => void
  setError: (message: string) => void
  clearMessages: () => void
  setLoading: (v: boolean) => void
}

const ChatbotContext = createContext<ChatbotContextValue | null>(null)

export function HelpChatbotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatbotState>({
    isOpen: false,
    messages: [],
    sessionId: null,
    isLoading: false,
  })

  const toggle = useCallback(() => setState((s) => ({ ...s, isOpen: !s.isOpen })), [])
  const close = useCallback(() => setState((s) => ({ ...s, isOpen: false })), [])
  const setLoading = useCallback((v: boolean) => setState((s) => ({ ...s, isLoading: v })), [])

  const addUserMessage = useCallback((content: string) => {
    const msg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content }
    const assistantPlaceholder: ChatMessage = { id: `asst-${Date.now()}`, role: 'assistant', content: '', isStreaming: true }
    setState((s) => ({ ...s, messages: [...s.messages, msg, assistantPlaceholder], isLoading: true }))
  }, [])

  const appendToLastAssistant = useCallback((text: string) => {
    setState((s) => {
      const msgs = [...s.messages]
      const lastIdx = msgs.length - 1
      if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
        msgs[lastIdx] = { ...msgs[lastIdx], content: msgs[lastIdx].content + text }
      }
      return { ...s, messages: msgs }
    })
  }, [])

  const addToolUse = useCallback((tool: string, input: Record<string, unknown>) => {
    setState((s) => {
      const msgs = [...s.messages]
      const lastIdx = msgs.length - 1
      if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
        msgs[lastIdx] = { ...msgs[lastIdx], toolUse: { tool, input } }
      }
      return { ...s, messages: msgs }
    })
  }, [])

  const finishStream = useCallback((sessionId: string | null) => {
    setState((s) => {
      const msgs = s.messages.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m)
      return { ...s, messages: msgs, isLoading: false, sessionId: sessionId ?? s.sessionId }
    })
  }, [])

  const setError = useCallback((message: string) => {
    setState((s) => {
      const msgs = [...s.messages]
      const lastIdx = msgs.length - 1
      if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant' && msgs[lastIdx].isStreaming) {
        msgs[lastIdx] = { ...msgs[lastIdx], content: message, isStreaming: false }
      }
      return { ...s, messages: msgs, isLoading: false }
    })
  }, [])

  const clearMessages = useCallback(() => {
    setState((s) => ({ ...s, messages: [], sessionId: null }))
  }, [])

  return (
    <ChatbotContext.Provider value={{ ...state, toggle, close, addUserMessage, appendToLastAssistant, addToolUse, finishStream, setError, clearMessages, setLoading }}>
      {children}
    </ChatbotContext.Provider>
  )
}

export function useChatbot() {
  const ctx = useContext(ChatbotContext)
  if (!ctx) throw new Error('useChatbot must be used within HelpChatbotProvider')
  return ctx
}
