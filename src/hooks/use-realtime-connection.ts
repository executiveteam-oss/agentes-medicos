'use client'

// ============================================================
// Suscripción realtime robusta para la bandeja de conversaciones.
//
// Cierra la FALLA SILENCIOSA: un websocket caído se ve igual que "no hay nada
// nuevo". Acá:
//   - `connected` refleja el status del canal → banner visible cuando NO está en
//     vivo (el caller lo muestra).
//   - `onResync` corre al (re)conectar → backfill de lo perdido durante la caída.
//   - JWT vencido = caída: al expirar, Realtime cierra el canal → cae en el
//     status callback (no silencio). En TOKEN_REFRESHED re-autenticamos; en
//     visibilitychange/online forzamos resuscribe + backfill (pestaña dormida,
//     wifi que volvió sin que el socket lo note).
//   - AUTENTICACIÓN DEL SOCKET: antes de cada subscribe se llama a
//     realtime.setAuth(token) con el JWT del usuario. Sin esto RLS evalúa como
//     anon (auth.uid() NULL) → el canal dice SUBSCRIBED pero NO entrega ni una
//     fila. `createBrowserClient` no cablea el token del socket solo.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export function useRealtimeConnection(opts: {
  channelName: string
  /** Agrega los .on('postgres_changes', ...) al canal y lo devuelve. */
  bind: (channel: RealtimeChannel) => RealtimeChannel
  /** Se llama al (re)conectar y al volver el foco/red → backfill de lo perdido. */
  onResync?: () => void
  /** Cambian → se recrea la suscripción (ej. conversationId, clinicId). */
  deps?: React.DependencyList
}): { connected: boolean } {
  const { channelName, bind, onResync, deps = [] } = opts
  // Optimista: asumimos conectado hasta que el status diga lo contrario, para no
  // parpadear el banner en el primer render.
  const [connected, setConnected] = useState(true)

  const bindRef = useRef(bind)
  bindRef.current = bind
  const resyncRef = useRef(onResync)
  resyncRef.current = onResync

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    let channel: RealtimeChannel | null = null
    let disposed = false

    const subscribe = async () => {
      if (channel) { supabase.removeChannel(channel); channel = null }
      // Autenticar el socket con el JWT del usuario ANTES de suscribir. Sin esto
      // RLS evalúa como anon y no llega ninguna fila aunque el canal conecte.
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) supabase.realtime.setAuth(session.access_token)
      } catch { /* si falla, el status callback marcará la caída */ }
      if (disposed) return
      const ch = bindRef.current(supabase.channel(channelName))
      ch.subscribe((status) => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          setConnected(true)
          resyncRef.current?.() // backfill al (re)conectar
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnected(false)
        }
      })
      channel = ch
      // El effect pudo limpiarse mientras esperábamos getSession → no dejar canal huérfano.
      if (disposed) { supabase.removeChannel(ch); channel = null }
    }
    void subscribe()

    // Auth: mantener Realtime autenticado. INITIAL_SESSION/SIGNED_IN cubren el
    // token que llega después del primer render; TOKEN_REFRESHED, la renovación.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (session?.access_token) supabase.realtime.setAuth(session.access_token)
      } else if (event === 'SIGNED_OUT') {
        setConnected(false)
      }
    })

    // Foco de la pestaña / red de vuelta → resuscribe + backfill.
    const onWake = () => { if (document.visibilityState === 'visible') void subscribe() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)

    return () => {
      disposed = true
      authSub.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
      if (channel) supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, ...deps])

  return { connected }
}
