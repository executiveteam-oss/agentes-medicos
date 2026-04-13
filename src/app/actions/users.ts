'use server'

// ============================================================
// Server Actions — Gestión de usuarios del consultorio
// invitar, actualizar rol, activar/desactivar, remover
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkWritePermission, getSessionClinicId } from '@/lib/actions-helpers'
import { getUserSession } from '@/lib/session'
import { sendEmail } from '@/lib/email/client'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'

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
  doctor_id: string | null
}

/** Invitar un nuevo usuario al consultorio via Resend */
export async function inviteUserAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')
    const session = await getUserSession()

    const email = formData.get('email') as string
    const fullName = formData.get('full_name') as string
    const roleId = formData.get('role_id') as string
    const doctorId = (formData.get('doctor_id') as string) || null

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

    // Verificar si ya hay una invitación pendiente
    const { data: existingInvite } = await supabaseAdmin
      .from('invitations')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('email', email)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existingInvite) {
      return { ok: false, error: 'Ya hay una invitación pendiente para este email' }
    }

    // Generar token de invitación
    const token = randomUUID()
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 horas

    // Obtener nombre de la clínica
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('name')
      .eq('id', clinicId)
      .maybeSingle()
    const clinicName = (clinic as { name: string } | null)?.name ?? 'tu consultorio'
    const inviterName = session?.fullName ?? 'El administrador'

    // Guardar invitación en DB
    const { error: insertError } = await supabaseAdmin
      .from('invitations')
      .insert({
        clinic_id: clinicId,
        email,
        full_name: fullName,
        role_id: roleId,
        doctor_id: doctorId,
        token,
        invited_by: session?.clinicUserId ?? null,
        expires_at: expiresAt.toISOString(),
      })

    if (insertError) {
      console.error('[inviteUserAction] Insert error:', insertError.message)
      return { ok: false, error: 'Error creando invitación' }
    }

    // Enviar email via Resend
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://agentes-medicos-ten.vercel.app'
    const acceptUrl = `${appUrl}/invite/accept?token=${token}`

    const emailResult = await sendEmail({
      to: email,
      subject: `Te invitaron a unirte a ${clinicName} en Omuwan`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; color: #1e293b;">
          <p>Hola,</p>
          <p><strong>${inviterName}</strong> te ha invitado a unirte a <strong>${clinicName}</strong> en Omuwan.</p>
          <p style="margin: 24px 0;">
            <a href="${acceptUrl}" style="display: inline-block; background: #0f2a6e; color: #fff; font-weight: 600; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
              Aceptar invitación
            </a>
          </p>
          <p style="font-size: 13px; color: #64748b;">Este enlace expira en 48 horas.</p>
          <p style="font-size: 13px; color: #64748b;">Si no esperabas esta invitación, puedes ignorar este correo.</p>
          <p style="color: #94a3b8; margin-top: 24px;">— El equipo de Omuwan</p>
        </div>
      `,
    })

    if (!emailResult.ok) {
      console.warn('[inviteUserAction] Email no enviado:', emailResult.error)
      // No fallar — la invitación ya está en DB, se puede reenviar
    }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'user_invited',
      actor_type: 'staff',
      target_type: 'invitation',
      details: { email, role_id: roleId, email_sent: emailResult.ok },
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

/** Reenviar invitación a un usuario via Resend */
export async function resendInvite(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    // Buscar invitación pendiente para este email
    const { data: inv } = await supabaseAdmin
      .from('invitations')
      .select('id, token, full_name, expires_at, accepted_at')
      .eq('clinic_id', clinicId)
      .eq('email', email)
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!inv) return { ok: false, error: 'No hay invitación pendiente para este email' }
    if (inv.accepted_at) return { ok: false, error: 'Esta invitación ya fue aceptada' }

    // Renovar expiración a 48h desde ahora
    const newExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000)
    await supabaseAdmin
      .from('invitations')
      .update({ expires_at: newExpiry.toISOString() })
      .eq('id', inv.id)

    // Obtener nombre de la clínica
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('name')
      .eq('id', clinicId)
      .maybeSingle()
    const clinicName = (clinic as { name: string } | null)?.name ?? 'tu consultorio'

    // Reenviar email via Resend
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://agentes-medicos-ten.vercel.app'
    const acceptUrl = `${appUrl}/invite/accept?token=${inv.token}`

    await sendEmail({
      to: email,
      subject: `Recordatorio: te invitaron a unirte a ${clinicName} en Omuwan`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; color: #1e293b;">
          <p>Hola ${inv.full_name},</p>
          <p>Tienes una invitación pendiente para unirte a <strong>${clinicName}</strong> en Omuwan.</p>
          <p style="margin: 24px 0;">
            <a href="${acceptUrl}" style="display: inline-block; background: #0f2a6e; color: #fff; font-weight: 600; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
              Aceptar invitación
            </a>
          </p>
          <p style="font-size: 13px; color: #64748b;">Este enlace expira en 48 horas.</p>
          <p style="color: #94a3b8; margin-top: 24px;">— El equipo de Omuwan</p>
        </div>
      `,
    })

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'invite_resent',
      actor_type: 'staff',
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

/** Actualizar el doctor vinculado a un usuario */
export async function updateUserDoctor(
  clinicUserId: string,
  doctorId: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await checkWritePermission('user_management')

    const { error } = await supabaseAdmin
      .from('clinic_users')
      .update({ doctor_id: doctorId || null })
      .eq('id', clinicUserId)
      .eq('clinic_id', clinicId)

    if (error) return { ok: false, error: 'Error actualizando médico vinculado' }

    await supabaseAdmin.from('audit_log').insert({
      clinic_id: clinicId,
      action: 'user_doctor_updated',
      actor_type: 'staff',
      target_type: 'clinic_user',
      target_id: clinicUserId,
      details: { doctor_id: doctorId },
    })

    revalidatePath('/dashboard/settings/users')
    return { ok: true }
  } catch (err) {
    console.error('[updateUserDoctor]', err)
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
      doctor_id,
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
      doctor_id: (cu as Record<string, unknown>).doctor_id as string | null ?? null,
    })
  }

  return enriched
}
