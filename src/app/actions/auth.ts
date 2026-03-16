'use server'

// ============================================================
// Server Actions — Autenticación con Supabase Auth
// login, registro de nueva clínica, logout
// ============================================================

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { seedDefaultRoles } from '@/lib/seed-roles'
import { redirect } from 'next/navigation'

/** Iniciar sesión con email y contraseña */
export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email y contraseña son requeridos' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    console.error('[loginAction] Supabase error:', error.message, error.status, error.name)

    // Mensajes específicos según el error real de Supabase
    if (error.message === 'Invalid login credentials') {
      return { error: 'Email o contraseña incorrectos' }
    }
    if (error.message === 'Email not confirmed') {
      return { error: 'Tu email no ha sido confirmado. Revisa tu bandeja de entrada.' }
    }
    if (error.message?.includes('rate limit')) {
      return { error: 'Demasiados intentos. Espera un momento antes de intentar de nuevo.' }
    }
    return { error: `Error al iniciar sesión: ${error.message}` }
  }

  redirect('/dashboard')
}

/**
 * Registrar nueva clínica y usuario administrador.
 * Flujo:
 * 1. Crear usuario en Supabase Auth
 * 2. Crear la clínica
 * 3. Crear los 5 roles predefinidos
 * 4. Vincular usuario como Admin de la clínica
 * 5. Redirigir al onboarding
 */
export async function registerAction(formData: FormData): Promise<{ error?: string }> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string
  const clinicName = formData.get('clinic_name') as string
  const specialtyRaw = formData.getAll('specialty') as string[]
  const specialty = specialtyRaw.filter(Boolean)

  if (!email || !password || !fullName || !clinicName) {
    return { error: 'Todos los campos son requeridos' }
  }

  if (password.length < 6) {
    return { error: 'La contraseña debe tener al menos 6 caracteres' }
  }

  // 1. Crear usuario en Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirmar en MVP (sin email verification)
    user_metadata: { full_name: fullName },
  })

  if (authError || !authData.user) {
    console.error('[registerAction] Auth error:', authError?.message, authError?.status)
    if (authError?.message?.includes('already registered')) {
      return { error: 'Este email ya está registrado' }
    }
    if (authError?.message?.includes('password')) {
      return { error: `Error con la contraseña: ${authError.message}` }
    }
    if (authError?.message?.includes('email')) {
      return { error: `Error con el email: ${authError.message}` }
    }
    return { error: `Error creando el usuario: ${authError?.message ?? 'Respuesta vacía de Auth'}` }
  }

  const authUserId = authData.user.id

  try {
    // 2. Crear la clínica con slug único basado en el nombre
    const slug = clinicName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      + '-' + Date.now().toString(36)

    const trialEndsAt = new Date()
    trialEndsAt.setDate(trialEndsAt.getDate() + 14)

    const { data: clinic, error: clinicError } = await supabaseAdmin
      .from('clinics')
      .insert({
        name: clinicName,
        slug,
        phone: '',
        specialty: specialty.length > 0 ? specialty : [],
        subscription_status: 'trial',
        subscription_plan: 'basic',
        trial_ends_at: trialEndsAt.toISOString(),
        daily_goal_appointments: 8,
      })
      .select('id')
      .single()

    if (clinicError || !clinic) {
      console.error('[registerAction] Clinic insert error:', clinicError?.message, clinicError?.code)
      throw new Error(`Error creando la clínica: ${clinicError?.message ?? 'Sin datos'}`)
    }

    // 3. Crear los 5 roles predefinidos y obtener el ID del rol Admin
    const adminRoleId = await seedDefaultRoles(clinic.id)

    // 4. Vincular usuario como Admin de la clínica
    const { error: userError } = await supabaseAdmin
      .from('clinic_users')
      .insert({
        clinic_id: clinic.id,
        auth_user_id: authUserId,
        full_name: fullName,
        role_id: adminRoleId,
        is_active: true,
      })

    if (userError) {
      console.error('[registerAction] clinic_users insert error:', userError.message, userError.code)
      throw new Error(`Error vinculando usuario a la clínica: ${userError.message}`)
    }

    // 5. Crear sesión para el usuario recién creado
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signInWithPassword({ email, password })

  } catch (err) {
    // Si algo falló, eliminar el usuario de Auth para no dejar huérfanos
    await supabaseAdmin.auth.admin.deleteUser(authUserId)
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[registerAction]', message)
    return { error: message }
  }

  redirect('/onboarding')
}

/** Cerrar sesión */
export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
