'use client'

// ============================================================
// Contexto de sesión del usuario
// Disponible en toda la app a través de useUserSession()
// Se inicializa desde el Server Component (layout del dashboard)
// ============================================================

import { createContext, useContext } from 'react'
import type { UserSession } from '@/types/permissions'

const UserSessionContext = createContext<UserSession | null>(null)

export function UserSessionProvider({
  session,
  children,
}: {
  session: UserSession | null
  children: React.ReactNode
}) {
  return (
    <UserSessionContext.Provider value={session}>
      {children}
    </UserSessionContext.Provider>
  )
}

/**
 * Hook para acceder a la sesión del usuario en componentes cliente.
 * Retorna null si no hay sesión activa.
 */
export function useUserSession(): UserSession | null {
  return useContext(UserSessionContext)
}

/**
 * Hook que asume que hay sesión activa (para usar dentro del dashboard).
 * Lanza error si se usa fuera del provider con sesión.
 */
export function useRequiredSession(): UserSession {
  const session = useContext(UserSessionContext)
  if (!session) throw new Error('useRequiredSession: no hay sesión activa')
  return session
}
