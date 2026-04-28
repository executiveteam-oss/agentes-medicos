'use client'

// ============================================================
// Tooltip — lightweight v2 tooltip (no radix dependency)
// Desktop: hover shows tooltip. Mobile: no tooltip (use tap→modal)
// ============================================================

import { useState, useRef, useCallback, type ReactNode } from 'react'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom'
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setVisible(true), 300)
  }, [])

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }, [])

  return (
    <div
      style={{ position: 'relative', display: 'contents' }}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && (
        <div
          style={{
            position: 'absolute',
            [side === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            padding: '8px 12px',
            borderRadius: 'var(--v2-radius)',
            background: 'var(--v2-text)',
            color: '#fff',
            fontSize: '11.5px',
            fontFamily: 'var(--font-manrope), sans-serif',
            lineHeight: 1.4,
            whiteSpace: 'pre-line',
            maxWidth: '260px',
            boxShadow: 'var(--v2-shadow-lg)',
            pointerEvents: 'none',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
