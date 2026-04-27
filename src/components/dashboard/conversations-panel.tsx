'use client'

// ============================================================
// ConversationsPanel v2 — Lista filtrable con realtime
// ============================================================

import { useState, useEffect } from 'react'
import { getInitials, getAvatarGradient, AVATAR_GRADIENTS } from '@/lib/utils/ui-helpers'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { Search, MessageCircle } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface ConversationEntry {
  id: string
  patient_id: string | null
  patient_name: string
  patient_phone: string
  patient_eps: string | null
  status: 'active' | 'escalated' | 'resolved'
  last_message_at: string
  last_message_preview: string
  last_message_role: string
  message_count: number
}

interface Props {
  entries: ConversationEntry[]
  counts: { all: number; active: number; escalated: number; resolved: number }
  clinicId: string
}

type FilterKey = 'all' | 'active' | 'escalated' | 'resolved'

const FILTERS: { key: FilterKey; label: string; emoji: string }[] = [
  { key: 'all', label: 'Todas', emoji: '' },
  { key: 'active', label: 'Bot manejando', emoji: '🤖' },
  { key: 'escalated', label: 'Atencion', emoji: '⚠️' },
  { key: 'resolved', label: 'Resueltas', emoji: '✅' },
]




export function ConversationsPanel({ entries: initialEntries, counts: initialCounts, clinicId }: Props) {
  const [entries, setEntries] = useState(initialEntries)
  const [counts, setCounts] = useState(initialCounts)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')

  // Sync with server if props change (navigation)
  useEffect(() => {
    setEntries(initialEntries)
    setCounts(initialCounts)
  }, [initialEntries, initialCounts])

  // Realtime: listen for conversation changes
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel('conv-list-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `clinic_id=eq.${clinicId}` },
        () => {
          // Simple approach: reload page on any conversation change
          window.location.reload()
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [clinicId])

  const filtered = entries.filter((e) => {
    if (filter !== 'all' && e.status !== filter) return false
    if (search.trim()) {
      const s = search.toLowerCase().trim()
      if (!e.patient_name.toLowerCase().includes(s) && !e.patient_phone.includes(s)) return false
    }
    return true
  })

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>
      {/* Search + Filter card */}
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          overflow: 'hidden',
        }}
      >
        {/* Search */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-border-soft)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--v2-text-subtle)' }} />
            <input
              type="text"
              placeholder="Buscar por nombre o telefono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-v2"
              style={{ paddingLeft: '38px' }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const count = counts[f.key]
            const isActive = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '999px',
                  fontSize: '12.5px',
                  fontWeight: isActive ? 700 : 500,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: 'var(--font-manrope), sans-serif',
                  ...(isActive
                    ? {
                        background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)',
                        color: '#fff',
                        boxShadow: '0 2px 6px rgba(107, 91, 255, 0.25)',
                      }
                    : {
                        background: 'var(--v2-bg-soft)',
                        color: 'var(--v2-text-muted)',
                      }),
                }}
              >
                {f.emoji && <span>{f.emoji}</span>}
                {f.label}
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '999px',
                    ...(isActive
                      ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                      : {
                          background: f.key === 'escalated' && count > 0 ? 'var(--v2-pink-soft)' : 'var(--v2-bg-deeper)',
                          color: f.key === 'escalated' && count > 0 ? 'var(--v2-pink)' : 'var(--v2-text-subtle)',
                        }),
                  }}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <MessageCircle size={40} style={{ color: 'var(--v2-primary)', opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>
              {search ? 'Sin resultados' : filter !== 'all' ? `No hay conversaciones ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}` : 'Aun no hay conversaciones'}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>
              {search ? 'Intenta con otro termino' : 'Las conversaciones de pacientes via WhatsApp apareceran aqui'}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((entry, idx) => {
              const isUnread = entry.last_message_role === 'patient'
              const timeAgo = formatDistanceToNow(new Date(entry.last_message_at), { addSuffix: true, locale: es })

              return (
                <Link
                  key={entry.id}
                  href={`/dashboard/conversations/${entry.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 18px',
                    borderBottom: idx < filtered.length - 1 ? '1px solid var(--v2-border-soft)' : 'none',
                    textDecoration: 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Avatar */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        background: getAvatarGradient(entry.patient_name),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: isUnread ? '0 0 0 2px var(--v2-bg-card), 0 0 0 4px var(--v2-primary-soft)' : 'none',
                      }}
                    >
                      <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{getInitials(entry.patient_name)}</span>
                    </div>
                    {/* Status dot */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '0',
                        right: '0',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        border: '2px solid var(--v2-bg-card)',
                        background: entry.status === 'escalated' ? 'var(--v2-amber)' : entry.status === 'resolved' ? 'var(--v2-text-subtle)' : 'var(--v2-primary)',
                      }}
                    />
                  </div>

                  {/* Center */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <p style={{
                        fontSize: '13.5px',
                        fontWeight: isUnread ? 700 : 600,
                        color: 'var(--v2-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {entry.patient_name}
                      </p>
                      {entry.status === 'escalated' && (
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'var(--v2-amber-soft)', color: '#b07d00' }}>
                          ESC
                        </span>
                      )}
                      {entry.last_message_role === 'staff' && (
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'var(--v2-pink-soft)', color: 'var(--v2-pink)' }}>
                          TU
                        </span>
                      )}
                    </div>
                    <p style={{
                      fontSize: '12px',
                      color: isUnread ? 'var(--v2-text)' : 'var(--v2-text-subtle)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {entry.last_message_role === 'agent' && '🤖 '}
                      {entry.last_message_preview || 'Sin mensajes'}
                    </p>
                  </div>

                  {/* Right */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{
                      fontSize: '11px',
                      fontFamily: 'var(--font-jetbrains), monospace',
                      fontWeight: 500,
                      color: isUnread ? 'var(--v2-primary)' : 'var(--v2-text-subtle)',
                    }}>
                      {timeAgo}
                    </p>
                    {isUnread && (
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: 'var(--v2-pink)',
                          marginLeft: 'auto',
                          marginTop: '4px',
                        }}
                      />
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
