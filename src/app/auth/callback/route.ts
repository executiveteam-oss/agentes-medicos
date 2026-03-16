// ============================================================
// Handler para el callback de Supabase Auth
// Maneja OAuth, magic links e invitaciones por email
// ============================================================

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Error en el callback → redirigir a login con error
  return NextResponse.redirect(`${origin}/login?error=callback_error`)
}
