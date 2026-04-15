'use server'

// ============================================================
// Server Actions — Wizard de onboarding
// Cada acción corresponde a un paso del wizard
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getSessionClinicId } from '@/lib/actions-helpers'
import { getUserSession } from '@/lib/session'
import { sendEmail } from '@/lib/email/client'
import { randomUUID } from 'crypto'
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

/** Paso 3: Invitar un usuario por email via Resend */
export async function inviteUser(data: {
  email: string
  full_name: string
  role_id: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()
    const session = await getUserSession()

    const token = randomUUID()
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

    // Obtener nombre de la clínica
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('name')
      .eq('id', clinicId)
      .maybeSingle()
    const clinicName = (clinic as { name: string } | null)?.name ?? 'tu consultorio'
    const inviterName = session?.fullName ?? 'El administrador'

    // Guardar invitación en tabla
    const { error: insertError } = await supabaseAdmin
      .from('invitations')
      .insert({
        clinic_id: clinicId,
        email: data.email,
        full_name: data.full_name,
        role_id: data.role_id,
        token,
        invited_by: session?.clinicUserId ?? null,
        expires_at: expiresAt.toISOString(),
      })

    if (insertError) {
      console.error('[inviteUser] Insert error:', insertError.message)
      return { ok: false, error: 'Error creando invitación' }
    }

    // Enviar email via Resend
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://agentes-medicos-ten.vercel.app'
    const acceptUrl = `${appUrl}/invite/accept?token=${token}`

    await sendEmail({
      to: data.email,
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
          <p style="color: #94a3b8; margin-top: 24px;">— El equipo de Omuwan</p>
        </div>
      `,
    })

    return { ok: true }
  } catch (err) {
    console.error('[inviteUser]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/** Paso 4: Actualizar configuración de WhatsApp (opcional) */
export async function updateWhatsappConfig(data: {
  whatsapp_phone_id: string
  whatsapp_access_token: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const clinicId = await getSessionClinicId()

    // TODO SECURITY: whatsapp_access_token almacenado como texto plano — migrar a Supabase Vault (SEC-001)
    const { error } = await supabaseAdmin
      .from('clinics')
      .update({
        whatsapp_phone_id: data.whatsapp_phone_id || null,
        whatsapp_access_token: data.whatsapp_access_token || null,
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
