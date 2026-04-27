// ============================================================
// Página de aceptación de invitación
// Flujo 1 (legacy): ?next=/invite/accept via Supabase callback
// Flujo 2 (nuevo): ?token=xxx via Resend email
// ============================================================

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { AcceptInviteForm } from './accept-form'
import { TokenInviteForm } from './token-form'
import { validateInvitationToken } from '@/app/actions/accept-invite'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const params = await searchParams
  const token = params.token

  // --- Flujo 2: Token propio (nuevo, vía Resend) ---
  if (token) {
    const result = await validateInvitationToken(token)

    if (!result.valid || !result.invitation) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
          <div className="w-full max-w-md card p-8 text-center">
            <p className="text-3xl mb-3">❌</p>
            <h1 className="text-xl font-semibold text-slate-900 mb-2">Invitación no válida</h1>
            <p className="text-slate-500 text-sm mb-4">{result.error}</p>
            <a href="/login" className="btn-v2-primary inline-block px-6 py-2">Ir al login</a>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="card-v2 p-8">
            <div className="text-center mb-6">
              <p className="text-3xl mb-3">🎉</p>
              <h1 className="text-xl font-semibold text-slate-900 mb-2">Has sido invitado</h1>
              <p className="text-slate-500 text-sm">
                Te han invitado a <strong className="text-slate-700">{result.invitation.clinicName}</strong> como <strong className="text-slate-700">{result.invitation.roleName}</strong>
              </p>
            </div>
            <TokenInviteForm
              token={token}
              defaultName={result.invitation.fullName}
              email={result.invitation.email}
            />
          </div>
          <p className="text-center text-xs text-slate-400 mt-6">
            Al continuar, aceptas el tratamiento de tus datos según la Ley 1581/2012.
          </p>
        </div>
      </div>
    )
  }

  // --- Flujo 1 (legacy): usuario ya autenticado via Supabase callback ---
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?error=invite_expired')
  }

  const { data: clinicUser } = await supabaseAdmin
    .from('clinic_users')
    .select(`full_name, clinic_roles ( name ), clinics ( name )`)
    .eq('auth_user_id', user.id)
    .limit(1)
    .maybeSingle()

  const clinicName = (() => {
    const raw = clinicUser?.clinics
    if (Array.isArray(raw)) return (raw[0] as { name: string } | undefined)?.name ?? 'tu consultorio'
    if (raw && typeof raw === 'object' && 'name' in raw) return (raw as { name: string }).name
    return 'tu consultorio'
  })()

  const roleName = (() => {
    const raw = clinicUser?.clinic_roles
    if (Array.isArray(raw)) return (raw[0] as { name: string } | undefined)?.name ?? 'miembro'
    if (raw && typeof raw === 'object' && 'name' in raw) return (raw as { name: string }).name
    return 'miembro'
  })()

  const fullName = clinicUser?.full_name ?? user.user_metadata?.full_name ?? ''

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="card-v2 p-8">
          <div className="text-center mb-6">
            <p className="text-3xl mb-3">🎉</p>
            <h1 className="text-xl font-semibold text-slate-900 mb-2">Has sido invitado</h1>
            <p className="text-slate-500 text-sm">
              Te han invitado a <strong className="text-slate-700">{clinicName}</strong> como <strong className="text-slate-700">{roleName}</strong>
            </p>
          </div>
          <AcceptInviteForm defaultName={fullName} />
        </div>
        <p className="text-center text-xs text-slate-400 mt-6">
          Al continuar, aceptas el tratamiento de tus datos según la Ley 1581/2012.
        </p>
      </div>
    </div>
  )
}
