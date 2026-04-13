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
  const invitationCode = ((formData.get('invitation_code') as string) || '').trim()
  const specialtyRaw = formData.getAll('specialty') as string[]
  const specialty = specialtyRaw.filter(Boolean)

  // Validar código de invitación
  const validCodes = (process.env.VALID_INVITE_CODES ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

  if (!invitationCode || !validCodes.includes(invitationCode.toLowerCase())) {
    return { error: 'Código de invitación inválido. Contáctanos en executive.team@loncocapital.com para solicitar acceso.' }
  }

  // Doctor range from registration form
  const doctorRange = (formData.get('doctor_range') as string) || null
  const doctorCountMap: Record<string, number> = { '1': 1, '2-3': 2, '4-6': 4, '7-10': 7 }
  const priceMap: Record<string, number> = { '1': 390000, '2-3': 620000, '4-6': 850000, '7-10': 1090000 }
  const cfgMedicos = doctorRange ? (doctorCountMap[doctorRange] ?? null) : null
  const cfgPlanPrice = doctorRange ? (priceMap[doctorRange] ?? null) : null

  // Configurator selections (optional, from pricing wizard)
  const cfgPlan = (formData.get('cfg_plan') as string) || 'core'
  const cfgCitas = parseInt((formData.get('cfg_citas') as string) || '', 10) || null
  const cfgFeaturesRaw = (formData.get('cfg_features') as string) || ''
  const cfgFeaturesList = cfgFeaturesRaw.split(',').filter(Boolean)

  if (!email || !password || !fullName || !clinicName) {
    return { error: 'Todos los campos son requeridos' }
  }

  if (password.length < 10) {
    return { error: 'La contraseña debe tener al menos 10 caracteres' }
  }

  // 1. Crear usuario en Supabase Auth
  // Auto-confirmar usuario — login inmediato sin verificación de email
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirmar — login inmediato tras registro
    user_metadata: { full_name: fullName },
  })

  if (authError || !authData.user) {
    console.error('[registerAction] Auth error:', authError?.message, authError?.status)
    if (authError?.message?.includes('already been registered') || authError?.message?.includes('already exists')) {
      return { error: 'ALREADY_REGISTERED' }
    }
    if (authError?.message?.includes('password')) {
      return { error: 'La contraseña no cumple los requisitos mínimos de seguridad.' }
    }
    return { error: process.env.NODE_ENV === 'development'
      ? `Error: ${authError?.message ?? 'Respuesta vacía de Auth'}`
      : 'No se pudo crear la cuenta. Verifica los datos e intenta de nuevo.'
    }
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
      cartera: false,           // Plus — módulo pago
      facturacion: false,       // Plus — módulo pago
      estadisticas: false,      // Plus — módulo pago
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
        preferred_plan_price: cfgPlanPrice,
        expected_doctors: cfgMedicos,
        expected_monthly_appointments: cfgCitas,
        doctor_range: doctorRange,
        invitation_code: invitationCode,
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

    // Crear sesión para el usuario recién creado
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
