'use server'

// ============================================================
// Server Actions — Gestión de roles del consultorio
// crear, actualizar, eliminar roles
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, getSessionClinicId } from '@/lib/actions-helpers'
import { revalidatePath } from 'next/cache'
import type { Permissions } from '@/types/permissions'

/** Crear un nuevo rol personalizado */
export async function createRole(data: {
  name: string
  description: string
  permissions: Permissions
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    const { data: inserted, error } = await supabaseAdmin
      .from('clinic_roles')
      .insert({
        clinic_id: clinicId,
        name: data.name,
        description: data.description,
        permissions: data.permissions,
        is_default: false,
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: 'Error creando rol' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'role_created',
      actor_type: 'staff',
      target_type: 'clinic_role',
      target_id: inserted.id,
      details: { name: data.name },
    })

    revalidatePath('/dashboard/settings/roles')
    return { ok: true }
  } catch (err) {
    console.error('[createRole]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Actualizar un rol existente */
export async function updateRole(
  roleId: string,
  data: { name?: string; description?: string; permissions?: Permissions }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    const { error } = await supabaseAdmin
      .from('clinic_roles')
      .update(data)
      .eq('id', roleId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando rol' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'role_updated',
      actor_type: 'staff',
      target_type: 'clinic_role',
      target_id: roleId,
      details: { updated_fields: Object.keys(data) },
    })

    revalidatePath('/dashboard/settings/roles')
    return { ok: true }
  } catch (err) {
    console.error('[updateRole]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Eliminar un rol (no se puede si hay usuarios asignados) */
export async function deleteRole(roleId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    // Verificar que no haya usuarios con este rol
    const { count } = await supabaseAdmin
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', roleId)
      .eq('clinic_id', clinicId)

    if (count && count > 0) {
      return { ok: false, error: 'No se puede eliminar un rol que tiene usuarios asignados' }
    }

    const { error } = await supabaseAdmin
      .from('clinic_roles')
      .delete()
      .eq('id', roleId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error eliminando rol' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'role_deleted',
      actor_type: 'staff',
      target_type: 'clinic_role',
      target_id: roleId,
      details: {},
    })

    revalidatePath('/dashboard/settings/roles')
    return { ok: true }
  } catch (err) {
    console.error('[deleteRole]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Obtener todos los roles del consultorio */
export async function getClinicRoles() {
  const clinicId = await getSessionClinicId()

  const { data } = await supabaseAdmin
    .from('clinic_roles')
    .select('id, name, description, permissions, is_default, created_at')
    .eq('clinic_id', clinicId)
    .order('name')

  return data ?? []
}
