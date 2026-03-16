// ============================================================
// Cliente Supabase para el servidor (Server Components, Route Handlers)
// Usa @supabase/ssr para leer/escribir cookies con Next.js
// SOLO para código del lado del servidor
// ============================================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch (err) {
            // En Server Components (lectura) el set falla — es esperado.
            // En Server Actions (login/register) DEBE funcionar.
            console.warn('[supabase/server] No se pudieron setear cookies:', err instanceof Error ? err.message : err)
          }
        },
      },
    }
  )
}
