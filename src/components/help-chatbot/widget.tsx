'use client'

// ============================================================
// HelpChatbotWidget — floating bubble + expanded panel
// ============================================================

import { MessageCircleQuestion } from 'lucide-react'
import { useChatbot } from './provider'
import { ChatPanel } from './chat-panel'

export function HelpChatbotWidget() {
  const { isOpen, toggle } = useChatbot()

  return (
    <>
      {/* Collapsed bubble */}
      {!isOpen && (
        <button
          onClick={toggle}
          title="Preguntale a Omu"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(107, 91, 255, 0.35)',
            zIndex: 45,
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(107, 91, 255, 0.5)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(107, 91, 255, 0.35)' }}
        >
          <MessageCircleQuestion size={24} />
        </button>
      )}

      {/* Expanded panel */}
      <ChatPanel />
    </>
  )
}
