// ============================================================
// Página de aceptación de invitación
// El usuario llega aquí después del callback con ?next=/invite/accept
// Ya tiene sesión activa, necesita setear su contraseña
// ============================================================

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { AcceptInviteForm } from './accept-form'

export const dynamic = 'force-dynamic'

export default async function AcceptInvitePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?error=invite_expired')
  }

  // Buscar el vínculo a la clínica
  const { data: clinicUser } = await supabaseAdmin
    .from('clinic_users')
    .select(`
      full_name,
      clinic_roles ( name ),
      clinics ( name )
    `)
    .eq('auth_user_id', user.id)
    .limit(1)
    .single()

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
        <div className="card p-8">
          <div className="text-center mb-6">
            <p className="text-3xl mb-3">🎉</p>
            <h1 className="text-xl font-semibold text-slate-900 mb-2">
              Has sido invitado
            </h1>
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
