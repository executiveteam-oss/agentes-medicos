// ============================================================
// Cliente Supabase para el navegador (componentes 'use client')
// Usa @supabase/ssr para manejo automático de cookies/sesión
// SOLO para componentes del lado del cliente
// ============================================================

import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
