'use server'

// ============================================================
// Server Action — Aceptar invitación
// Flujo 1 (legacy): usuario ya autenticado via Supabase invite link
// Flujo 2 (nuevo): token propio vía Resend email
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// --- Flujo legacy: usuario ya tiene sesión via callback ---

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
    if (password.length < 10) return { ok: false, error: 'La contraseña debe tener al menos 10 caracteres' }

    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return { ok: false, error: 'Sesión no encontrada. Intenta abrir el enlace de invitación nuevamente.' }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      { password }
    )

    if (updateError) {
      return { ok: false, error: 'Error al crear la contraseña' }
    }

    await supabaseAdmin
      .from('clinic_users')
      .update({ full_name: fullName.trim() })
      .eq('auth_user_id', user.id)

    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: { full_name: fullName.trim() },
    })

    return { ok: true }
  } catch (err) {
    console.error('[acceptInviteAction]', err)
    return { ok: false, error: 'Error inesperado. Intenta de nuevo.' }
  }
}

// --- Flujo nuevo: token propio via Resend ---

interface InvitationInfo {
  fullName: string
  email: string
  clinicName: string
  roleName: string
}

/** Validar token de invitación (sin login requerido) */
export async function validateInvitationToken(token: string): Promise<{
  valid: boolean
  error?: string
  invitation?: InvitationInfo
}> {
  if (!token) return { valid: false, error: 'Token requerido' }

  const { data } = await supabaseAdmin
    .from('invitations')
    .select('id, email, full_name, expires_at, accepted_at, clinics(name)')
    .eq('token', token)
    .maybeSingle()

  if (!data) return { valid: false, error: 'Invitación no encontrada' }

  const inv = data as { id: string; email: string; full_name: string; expires_at: string; accepted_at: string | null; clinics: { name: string } | { name: string }[] | null }
  if (inv.accepted_at) return { valid: false, error: 'Esta invitación ya fue aceptada' }
  if (new Date(inv.expires_at) < new Date()) return { valid: false, error: 'Esta invitación ha expirado. Pide una nueva al administrador.' }

  const clinicRaw = inv.clinics
  const clinicName = Array.isArray(clinicRaw)
    ? (clinicRaw[0] as { name: string })?.name ?? 'tu consultorio'
    : (clinicRaw as { name: string } | null)?.name ?? 'tu consultorio'

  return {
    valid: true,
    invitation: {
      fullName: inv.full_name,
      email: inv.email,
      clinicName,
      roleName: 'miembro del equipo',
    },
  }
}

/** Aceptar invitación con token: crear usuario + vincular a clínica */
export async function acceptTokenInvitation(
  token: string,
  fullName: string,
  password: string
): Promise<{ error?: string }> {
  if (!token || !fullName || !password) {
    return { error: 'Todos los campos son requeridos' }
  }
  if (password.length < 10) {
    return { error: 'La contraseña debe tener al menos 10 caracteres' }
  }

  // 1. Validar invitación
  const { data: inv } = await supabaseAdmin
    .from('invitations')
    .select('id, clinic_id, email, full_name, role_id, doctor_id, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle()

  if (!inv) return { error: 'Invitación no encontrada' }
  if (inv.accepted_at) return { error: 'Esta invitación ya fue aceptada' }
  if (new Date(inv.expires_at) < new Date()) return { error: 'Esta invitación ha expirado' }

  // 2. Verificar si el usuario ya existe en Supabase Auth
  let authUserId: string

  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
  const existingUser = existingUsers?.users?.find((u) => u.email === inv.email)

  if (existingUser) {
    // Usuario ya existe — solo vincular a la clínica
    authUserId = existingUser.id

    // Actualizar contraseña si proporcionó una nueva
    await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      password,
      user_metadata: { full_name: fullName },
    })
  } else {
    // Crear usuario nuevo (auto-confirmado)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: inv.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (authError || !authData.user) {
      console.error('[acceptTokenInvitation] Auth error:', authError?.message)
      return { error: 'Error creando la cuenta' }
    }

    authUserId = authData.user.id
  }

  // 3. Vincular a la clínica (con doctor_id si la invitación lo tiene)
  const clinicUserData: Record<string, unknown> = {
    clinic_id: inv.clinic_id,
    auth_user_id: authUserId,
    full_name: fullName,
    role_id: inv.role_id,
    is_active: true,
  }

  // Vincular doctor_id si está presente y no está ya vinculado a otro usuario
  const invDoctorId = (inv as Record<string, unknown>).doctor_id as string | null
  if (invDoctorId) {
    const { data: doctorRow } = await supabaseAdmin
      .from('clinic_users')
      .select('id')
      .eq('clinic_id', inv.clinic_id)
      .eq('doctor_id', invDoctorId)
      .maybeSingle()

    if (!doctorRow) {
      // Doctor no vinculado a nadie — vincular
      clinicUserData.doctor_id = invDoctorId
    } else {
      console.warn(`[acceptTokenInvitation] Doctor ${invDoctorId} ya vinculado a otro usuario, omitiendo`)
    }
  }

  const { error: linkError } = await supabaseAdmin
    .from('clinic_users')
    .upsert(clinicUserData, { onConflict: 'clinic_id,auth_user_id' })

  if (linkError) {
    console.error('[acceptTokenInvitation] Link error:', linkError.message)
    return { error: 'Error vinculando a la clínica' }
  }

  // 4. Marcar invitación como aceptada
  await supabaseAdmin
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inv.id)

  // 5. Audit log
  await supabaseAdmin.from('audit_log').insert({
    clinic_id: inv.clinic_id,
    action: 'invitation_accepted',
    actor_type: 'staff',
    actor_id: authUserId,
    details: { email: inv.email, role_id: inv.role_id },
  })

  // 6. Crear sesión e ir al dashboard
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signInWithPassword({ email: inv.email, password })

  redirect('/dashboard')
}
