'use client'

// ============================================================
// NotificationBell — Bell icon + badge + dropdown panel
// Uses Supabase Realtime for live updates
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useUserSession } from '@/context/user-session'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import type { StaffNotification } from '@/lib/notifications/types'

const TYPE_EMOJI: Record<string, string> = {
  appointment_canceled: '❌',
  appointment_rescheduled: '🔄',
  appointment_moved: '➡️',
}

export function NotificationBell() {
  const session = useUserSession()
  const router = useRouter()
  const [notifications, setNotifications] = useState<StaffNotification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const userId = session?.authUserId

  // Load initial notifications
  useEffect(() => {
    if (!userId) return
    const supabase = createSupabaseBrowserClient()

    supabase
      .from('staff_notifications')
      .select('*')
      .eq('recipient_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setNotifications(data as StaffNotification[])
        setLoaded(true)
      })
  }, [userId])

  // Realtime subscription
  useEffect(() => {
    if (!userId) return
    const supabase = createSupabaseBrowserClient()

    const channel = supabase
      .channel('staff-notif-bell')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'staff_notifications', filter: `recipient_user_id=eq.${userId}` },
        (payload) => {
          const newNotif = payload.new as StaffNotification
          setNotifications((prev) => [newNotif, ...prev].slice(0, 20))
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'staff_notifications', filter: `recipient_user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as StaffNotification
          setNotifications((prev) => prev.map((n) => n.id === updated.id ? updated : n))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const markAsRead = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from('staff_notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
  }, [])

  const markAllRead = useCallback(async () => {
    if (!userId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from('staff_notifications').update({ read_at: new Date().toISOString() }).eq('recipient_user_id', userId).is('read_at', null)
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
  }, [userId])

  function handleNotifClick(notif: StaffNotification) {
    if (!notif.read_at) markAsRead(notif.id)
    if (notif.navigate_to) router.push(notif.navigate_to)
    setIsOpen(false)
  }

  if (!loaded || !userId) return null

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '6px',
          color: isOpen ? 'var(--v2-primary)' : 'var(--v2-text-muted)',
          transition: 'color 0.15s',
        }}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: 'var(--v2-pink)',
              color: '#fff',
              fontSize: '9px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-jetbrains), monospace',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '8px',
            width: '360px',
            maxHeight: '480px',
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: 'var(--v2-radius-lg)',
            boxShadow: 'var(--v2-shadow-lg)',
            overflow: 'hidden',
            zIndex: 50,
            fontFamily: 'var(--font-manrope), sans-serif',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--v2-border-soft)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>
              Notificaciones
              {unreadCount > 0 && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--v2-pink)', marginLeft: '6px' }}>
                  {unreadCount} nueva{unreadCount !== 1 ? 's' : ''}
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--v2-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <Check size={12} /> Marcar todas
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <Bell size={28} style={{ color: 'var(--v2-text-subtle)', opacity: 0.3, margin: '0 auto 8px' }} />
                <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)' }}>Sin notificaciones</p>
              </div>
            ) : (
              notifications.slice(0, 10).map((notif) => {
                const isUnread = !notif.read_at
                return (
                  <button
                    key={notif.id}
                    onClick={() => handleNotifClick(notif)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      width: '100%',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--v2-border-soft)',
                      background: isUnread ? 'var(--v2-primary-tint)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-manrope), sans-serif',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { if (!isUnread) e.currentTarget.style.background = 'var(--v2-bg-soft)' }}
                    onMouseLeave={(e) => { if (!isUnread) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ fontSize: '18px', flexShrink: 0, marginTop: '2px' }}>
                      {TYPE_EMOJI[notif.type] ?? '📋'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '13px', fontWeight: isUnread ? 700 : 500, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {notif.title}
                      </p>
                      {notif.body && (
                        <p style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                          {notif.body}
                        </p>
                      )}
                      <p style={{ fontSize: '10px', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text-subtle)', marginTop: '3px' }}>
                        {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: es })}
                      </p>
                    </div>
                    {isUnread && (
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--v2-primary)', flexShrink: 0, marginTop: '6px' }} />
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--v2-border-soft)', textAlign: 'center' }}>
              {/* TODO: link to /dashboard/notifications full page */}
              <span style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>
                Mostrando ultimas {Math.min(10, notifications.length)} notificaciones
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
