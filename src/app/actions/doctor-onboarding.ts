'use server'

// ============================================================
// Server actions — Onboarding del doctor (primera vez)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { revalidatePath } from 'next/cache'

/** Marcar onboarding del doctor como completado */
export async function markDoctorOnboardingComplete(): Promise<{ ok: boolean; error?: string }> {
  const session = await getUserSession()
  if (!session) return { ok: false, error: 'No autenticado' }

  const { error } = await supabaseAdmin
    .from('clinic_users')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', session.clinicUserId)

  if (error) {
    console.error('[markDoctorOnboardingComplete]', error.message)
    return { ok: false, error: 'Error guardando estado' }
  }

  revalidatePath('/dashboard')
  return { ok: true }
}

/**
 * Verifica si el perfil del doctor está completo:
 * - Tiene al menos 1 horario configurado (working_hours no vacío)
 * - Tiene al menos 1 tipo de consulta activo
 */
export async function isDoctorProfileComplete(doctorId: string, clinicId: string): Promise<boolean> {
  // 1. Horario
  const { data: doctor } = await supabaseAdmin
    .from('doctors')
    .select('working_hours')
    .eq('id', doctorId)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  const hours = doctor?.working_hours as Record<string, { active?: boolean }> | null
  const hasSchedule = !!hours && Object.values(hours).some((d) => d?.active)

  if (!hasSchedule) return false

  // 2. Tipos de consulta activos
  const { count } = await supabaseAdmin
    .from('consultation_types')
    .select('id', { count: 'exact', head: true })
    .eq('doctor_id', doctorId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)

  return (count ?? 0) > 0
}
