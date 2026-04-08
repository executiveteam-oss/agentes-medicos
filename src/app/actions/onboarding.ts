'use server'

// ============================================================
// Server Actions — Wizard de onboarding
// Cada acción corresponde a un paso del wizard
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getSessionClinicId } from '@/lib/actions-helpers'
import { getUserSession } from '@/lib/session'
import { revalidatePath } from 'next/cache'

/** Paso 1: Actualizar datos básicos de la clínica */
export async function updateClinicData(data: {
  name: string
  address: string
  city: string
  phone: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando datos de la clínica' }
    return { ok: true }
  } catch (err) {
    console.error('[updateClinicData]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Paso 2: Actualizar permisos de un rol */
export async function updateRolePermissions(
  roleId: string,
  permissions: Record<string, { read: boolean; write: boolean }>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()

    // Verificar que el rol pertenece a esta clínica
    const { error } = await supabaseAdmin
      .from('clinic_roles')
      .update({ permissions })
      .eq('id', roleId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando rol' }
    return { ok: true }
  } catch (err) {
    console.error('[updateRolePermissions]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Paso 3: Invitar un usuario por email */
export async function inviteUser(data: {
  email: string
  full_name: string
  role_id: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()

    // Enviar invitación (Supabase enviará email automáticamente)
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        data: { full_name: data.full_name },
      }
    )

    if (inviteError) {
      return { ok: false, error: 'Error enviando invitación' }
    }

    if (!inviteData.user) {
      return { ok: false, error: 'No se pudo crear el usuario' }
    }

    // Pre-crear el clinic_user (el usuario completará el registro al aceptar la invitación)
    const { error: userError } = await supabaseAdmin
      .from('clinic_users')
      .upsert({
        clinic_id: clinicId,
        auth_user_id: inviteData.user.id,
        full_name: data.full_name,
        role_id: data.role_id,
        is_active: true,
      }, { onConflict: 'clinic_id,auth_user_id' })

    if (userError) {
      return { ok: false, error: 'Error registrando usuario en la clínica' }
    }

    return { ok: true }
  } catch (err) {
    console.error('[inviteUser]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Paso 4: Actualizar configuración de WhatsApp (opcional) */
export async function updateWhatsappConfig(data: {
  whatsapp_phone_id: string
  whatsapp_token: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()

    // TODO SECURITY: whatsapp_token almacenado como texto plano — migrar a Supabase Vault (SEC-001)
    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        whatsapp_phone_id: data.whatsapp_phone_id || null,
        whatsapp_token: data.whatsapp_token || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error guardando configuración WhatsApp' }
    return { ok: true }
  } catch (err) {
    console.error('[updateWhatsappConfig]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Paso 5: Marcar el onboarding como completado */
export async function markOnboarded(): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()

    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        onboarded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicId)

    if (error) return { ok: false, error: 'Error completando onboarding' }

    revalidatePath('/onboarding')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    console.error('[markOnboarded]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Obtener roles disponibles para la clínica actual */
export async function getClinicRoles() {
  const session = await getUserSession()
  if (!session) return []

  const { data } = await supabaseAdmin
    .from('clinic_roles')
    .select('id, name, description, permissions')
    .eq('clinic_id', session.clinicId)
    .order('name')

  return data ?? []
}
