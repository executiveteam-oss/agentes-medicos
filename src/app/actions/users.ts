'use server'

// ============================================================
// Server Actions — Gestión de usuarios del consultorio
// invitar, actualizar rol, activar/desactivar, remover
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, getSessionClinicId } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'

// Tipo enriquecido que retorna getClinicUsers
export interface ClinicUserRow {
  id: string
  full_name: string
  email: string
  is_active: boolean
  status: 'active' | 'inactive' | 'pending'
  created_at: string
  auth_user_id: string
  clinic_roles: { id: string; name: string } | null
}

/** Invitar un nuevo usuario al consultorio */
export async function inviteUserAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    const email = formData.get('email') as string
    const fullName = formData.get('full_name') as string
    const roleId = formData.get('role_id') as string

    if (!email || !fullName || !roleId) {
      return { ok: false, error: 'Todos los campos son requeridos' }
    }

    // Verificar si ya existe en la clínica
    const { data: existingByEmail } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingByEmail?.users?.find((u) => u.email === email)

    if (existingUser) {
      const { data: existingLink } = await supabaseAdmin
        .from('clinic_users')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('auth_user_id', existingUser.id)
        .maybeSingle()

      if (existingLink) {
        return { ok: false, error: 'Este email ya está registrado en el consultorio' }
      }
    }

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/invite/accept`,
        data: { full_name: fullName },
      }
    )

    if (inviteError || !inviteData.user) {
      return { ok: false, error: 'Error enviando invitación' }
    }

    await supabaseAdmin
      .from('clinic_users')
      .upsert({
        clinic_id: clinicId,
        auth_user_id: inviteData.user.id,
        full_name: fullName,
        role_id: roleId,
        is_active: true,
      }, { onConflict: 'clinic_id,auth_user_id' })

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'user_invited',
      actor_type: 'staff',
      target_type: 'clinic_user',
      target_id: inviteData.user.id,
      details: { email, role_id: roleId },
    })

    revalidatePath('/dashboard/settings/users')
    return { ok: true }
  } catch (err) {
    console.error('[inviteUserAction]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Actualizar el rol de un usuario */
export async function updateUserRole(
  clinicUserId: string,
  roleId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    const { error } = await supabaseAdmin
      .from('clinic_users')
      .update({ role_id: roleId })
      .eq('id', clinicUserId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando rol' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'user_role_updated',
      actor_type: 'staff',
      target_type: 'clinic_user',
      target_id: clinicUserId,
      details: { new_role_id: roleId },
    })

    revalidatePath('/dashboard/settings/users')
    return { ok: true }
  } catch (err) {
    console.error('[updateUserRole]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Activar o desactivar un usuario */
export async function toggleUserActive(
  clinicUserId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    const { error } = await supabaseAdmin
      .from('clinic_users')
      .update({ is_active: isActive })
      .eq('id', clinicUserId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando usuario' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: isActive ? 'user_activated' : 'user_deactivated',
      actor_type: 'staff',
      target_type: 'clinic_user',
      target_id: clinicUserId,
      details: { is_active: isActive },
    })

    revalidatePath('/dashboard/settings/users')
    return { ok: true }
  } catch (err) {
    console.error('[toggleUserActive]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Reenviar invitación a un usuario */
export async function resendInvite(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/invite/accept`,
    })

    if (error) return { ok: false, error: 'Error reenviando invitación' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'invite_resent',
      actor_type: 'staff',
      target_type: 'clinic_user',
      details: { email },
    })

    return { ok: true }
  } catch (err) {
    console.error('[resendInvite]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Remover un usuario del consultorio (elimina el vínculo, no la cuenta auth) */
export async function removeUserFromClinic(
  clinicUserId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    // Obtener info del usuario antes de eliminar
    const { data: user } = await supabaseAdmin
      .from('clinic_users')
      .select('auth_user_id, full_name')
      .eq('id', clinicUserId)
      .eq('clinic_id', clinicId)
      .single()

    if (!user) return { ok: false, error: 'Usuario no encontrado' }

    const { error } = await supabaseAdmin
      .from('clinic_users')
      .delete()
      .eq('id', clinicUserId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error removiendo usuario' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'user_removed',
      actor_type: 'staff',
      target_type: 'clinic_user',
      target_id: clinicUserId,
      details: { full_name: user.full_name },
    })

    revalidatePath('/dashboard/settings/users')
    return { ok: true }
  } catch (err) {
    console.error('[removeUserFromClinic]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Obtener lista de usuarios del consultorio (enriquecida con email y estado) */
export async function getClinicUsers(): Promise<ClinicUserRow[]> {
  const clinicId = await getSessionClinicId()

  const { data: clinicUsers } = await supabaseAdmin
    .from('clinic_users')
    .select(`
      id,
      full_name,
      is_active,
      created_at,
      auth_user_id,
      clinic_roles (
        id,
        name
      )
    `)
    .eq('clinic_id', clinicId)
    .order('created_at')

  if (!clinicUsers || clinicUsers.length === 0) return []

  // Obtener datos de auth para cada usuario (email, last_sign_in)
  const enriched: ClinicUserRow[] = []

  for (const cu of clinicUsers) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(cu.auth_user_id)

    const email = authUser?.user?.email ?? ''
    const lastSignIn = authUser?.user?.last_sign_in_at

    // Determinar estado:
    // - pending: is_active=true pero nunca ha iniciado sesión (invitado sin aceptar)
    // - active: is_active=true y ya inició sesión
    // - inactive: is_active=false
    let status: 'active' | 'inactive' | 'pending'
    if (!cu.is_active) {
      status = 'inactive'
    } else if (!lastSignIn) {
      status = 'pending'
    } else {
      status = 'active'
    }

    const role = Array.isArray(cu.clinic_roles) ? cu.clinic_roles[0] ?? null : cu.clinic_roles

    enriched.push({
      id: cu.id,
      full_name: cu.full_name,
      email,
      is_active: cu.is_active,
      status,
      created_at: cu.created_at,
      auth_user_id: cu.auth_user_id,
      clinic_roles: role as { id: string; name: string } | null,
    })
  }

  return enriched
}
