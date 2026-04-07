'use server'

// ============================================================
// Server Actions — Autenticación con Supabase Auth
// login, registro de nueva clínica, logout
// ============================================================

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { seedDefaultRoles } from '@/lib/seed-roles'
import { redirect } from 'next/navigation'
import { checkRateLimit } from '@/lib/rate-limit'
import type { FeatureConfig } from '@/types/database'

/** Iniciar sesión con email y contraseña */
export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email y contraseña son requeridos' }
  }

  // Rate limit: 5 intentos por email cada 15 minutos
  const rateLimit = checkRateLimit(`login:${email.toLowerCase()}`, { maxRequests: 5, windowSeconds: 900 })
  if (!rateLimit.allowed) {
    return { error: 'Demasiados intentos. Espera unos minutos antes de intentar de nuevo.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    console.error('[loginAction] Auth error code:', error.status, error.name)
    // Caso especial: email no confirmado — el usuario necesita saber para poder actuar
    if (error.message === 'Email not confirmed') {
      return { error: 'EMAIL_NOT_CONFIRMED' }
    }
    // SECURITY: mensaje genérico para todo lo demás — no revelar si el email existe
    return { error: 'Credenciales inválidas' }
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

  // Configurator selections (optional, from pricing wizard)
  const cfgPlan = (formData.get('cfg_plan') as string) || null
  const cfgMedicos = parseInt((formData.get('cfg_medicos') as string) || '', 10) || null
  const cfgCitas = parseInt((formData.get('cfg_citas') as string) || '', 10) || null
  const cfgFeaturesRaw = (formData.get('cfg_features') as string) || ''
  const cfgFeaturesList = cfgFeaturesRaw.split(',').filter(Boolean)

  if (!email || !password || !fullName || !clinicName) {
    return { error: 'Todos los campos son requeridos' }
  }

  if (password.length < 10) {
    return { error: 'La contraseña debe tener al menos 10 caracteres' }
  }

  // 1. Crear usuario en Supabase Auth (requiere confirmación de email)
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    // TODO: verificar que Supabase SMTP esté configurado con dominio propio para mejor entregabilidad
    // Por ahora usa el SMTP built-in de Supabase (noreply@mail.app.supabase.io)
    email_confirm: false, // Requiere verificación de email vía link
    user_metadata: { full_name: fullName },
  })

  if (authError || !authData.user) {
    console.error('[registerAction] Auth error code:', authError?.status)
    // SECURITY: mensaje genérico — no revelar si el email ya existe
    return { error: 'No se pudo crear la cuenta. Verifica los datos e intenta de nuevo.' }
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

    // Core plan: features incluidas por defecto
    // Plus modules: desactivados, se activan comprando módulo
    const featureConfig: FeatureConfig = {
      agent: true,              // Core — siempre activo
      reminders_24h: true,      // Core — siempre activo
      reminders_72h: true,      // Core — incluido
      docs_required: true,      // Core — incluido
      waitlist: true,           // Core — incluido
      dashboard: true,          // Core — siempre activo
      reactivation: false,      // Plus — módulo pago
      insights: false,          // Plus — módulo pago
      virtual: false,           // Plus — módulo pago
      vacations: false,         // Plus — módulo pago
      ai_assistant: false,      // Plus — módulo pago
    }

    // Map plan name → subscription_plan (Core + Plus model)
    const planMap: Record<string, string> = { core: 'core', basico: 'core', pro: 'core', clinica: 'core' }
    const subscriptionPlan = (cfgPlan && planMap[cfgPlan]) || 'core'

    const { data: clinic, error: clinicError } = await supabaseAdmin
      .from('clinics')
      .insert({
        name: clinicName,
        slug,
        phone: '',
        specialty: specialty.length > 0 ? specialty : [],
        subscription_status: 'trial',
        subscription_plan: subscriptionPlan,
        trial_ends_at: trialEndsAt.toISOString(),
        daily_goal_appointments: cfgCitas ? Math.round(cfgCitas / 22) : 8,
        feature_config: featureConfig as unknown as Record<string, unknown>,
        preferred_plan: cfgPlan,
        expected_doctors: cfgMedicos,
        expected_monthly_appointments: cfgCitas,
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

  } catch (err) {
    // Si algo falló, eliminar el usuario de Auth para no dejar huérfanos
    await supabaseAdmin.auth.admin.deleteUser(authUserId)
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[registerAction]', message)
    return { error: message }
  }

  // Email de verificación enviado por Supabase automáticamente
  redirect('/login?registered=true')
}

/** Reenviar email de confirmación */
export async function resendConfirmationAction(email: string): Promise<{ error?: string }> {
  if (!email) return { error: 'Email requerido' }

  const rateLimit = checkRateLimit(`resend:${email.toLowerCase()}`, { maxRequests: 3, windowSeconds: 300 })
  if (!rateLimit.allowed) {
    return { error: 'Espera unos minutos antes de solicitar otro correo.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resend({ type: 'signup', email })

  if (error) {
    console.error('[resendConfirmation] Error:', error.status)
  }
  // Siempre retornar éxito — no revelar si el email existe
  return {}
}

/** Solicitar restablecimiento de contraseña */
export async function forgotPasswordAction(email: string): Promise<{ error?: string }> {
  if (!email) return { error: 'Email requerido' }

  const rateLimit = checkRateLimit(`forgot:${email.toLowerCase()}`, { maxRequests: 3, windowSeconds: 300 })
  if (!rateLimit.allowed) {
    return { error: 'Espera unos minutos antes de solicitar otro correo.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
  })

  if (error) {
    console.error('[forgotPassword] Error:', error.status)
  }
  // Siempre retornar éxito — no revelar si el email existe
  return {}
}

/** Cerrar sesión */
export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
