'use server'

// ============================================================
// Server Action — Aceptar invitación (setear contraseña y nombre)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'

interface AcceptInviteInput {
  fullName: string
  password: string
}

export async function acceptInviteAction(
  input: AcceptInviteInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { fullName, password } = input

    if (!fullName.trim()) return { ok: false, error: 'El nombre es requerido' }
    if (password.length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres' }

    // Obtener sesión actual (el usuario ya está autenticado via el callback)
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return { ok: false, error: 'Sesión no encontrada. Intenta abrir el enlace de invitación nuevamente.' }
    }

    // Setear la contraseña
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      { password }
    )

    if (updateError) {
      return { ok: false, error: 'Error al crear la contraseña' }
    }

    // Actualizar nombre en clinic_users (por si el invitado quiere cambiarlo)
    const { error: nameError } = await supabaseAdmin
      .from('clinic_users')
      .update({ full_name: fullName.trim() })
      .eq('auth_user_id', user.id)

    if (nameError) {
      console.error('[acceptInviteAction] Error updating name:', nameError)
      // No fallar por esto, la contraseña ya se seteó
    }

    // Actualizar metadata en auth
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: { full_name: fullName.trim() },
    })

    return { ok: true }
  } catch (err) {
    console.error('[acceptInviteAction]', err)
    return { ok: false, error: 'Error inesperado. Intenta de nuevo.' }
  }
}
