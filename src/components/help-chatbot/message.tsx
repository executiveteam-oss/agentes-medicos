'use client'

// ============================================================
// ChatMessage bubble — user or assistant with optional navigate_to
// ============================================================

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { ChatMessage } from './provider'

export function MessageBubble({ msg }: { msg: ChatMessage }) {
  const router = useRouter()
  const isUser = msg.role === 'user'

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: '8px' }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: '14px',
          ...(isUser
            ? {
                background: 'var(--v2-primary-soft)',
                color: 'var(--v2-text)',
                borderBottomRightRadius: '4px',
              }
            : {
                background: 'var(--v2-bg-card)',
                border: '1px solid var(--v2-border-soft)',
                color: 'var(--v2-text)',
                borderBottomLeftRadius: '4px',
              }),
        }}
      >
        {/* Text content */}
        <div
          style={{ fontSize: '13.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
        />

        {/* Streaming dots */}
        {msg.isStreaming && msg.content === '' && (
          <div style={{ display: 'flex', gap: '4px', padding: '4px 0' }}>
            <span className="animate-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--v2-text-subtle)' }} />
            <span className="animate-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--v2-text-subtle)', animationDelay: '0.15s' }} />
            <span className="animate-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--v2-text-subtle)', animationDelay: '0.3s' }} />
          </div>
        )}

        {/* navigate_to button */}
        {msg.toolUse?.tool === 'navigate_to' && (
          <button
            onClick={() => router.push(msg.toolUse!.input.path as string)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '8px',
              padding: '7px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              color: '#fff',
              background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-primary-deep))',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-manrope), sans-serif',
              boxShadow: '0 2px 6px rgba(107, 91, 255, 0.25)',
            }}
          >
            {(msg.toolUse.input.label as string) ?? 'Ir'} <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Minimal markdown: **bold**, `code`, bullet lists */
function renderMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code style="background:var(--v2-bg-soft);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/^- (.+)$/gm, '• $1')
    .replace(/✓/g, '<span style="color:var(--v2-green)">✓</span>')
}
