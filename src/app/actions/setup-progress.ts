'use server'

// ============================================================
// Server actions: Checklist de activación post-onboarding
// Calcula dinámicamente el progreso de configuración de la clínica
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getSessionClinicId } from '@/lib/actions-helpers'

export interface SetupProgress {
  clinic_data_complete: boolean
  doctors_added: boolean
  consultation_types_added: boolean
  whatsapp_connected: boolean
  team_invited: boolean
  completed_at: string | null
}

/**
 * Calcula el progreso actual de configuración evaluando datos reales.
 * Actualiza la tabla clinic_setup_progress y retorna el estado.
 */
export async function getSetupProgress(): Promise<SetupProgress | null> {
  try {
    const clinicId = await getSessionClinicId()

    // Evaluar todas las condiciones en paralelo
    const [clinicRes, doctorsRes, ctRes, usersRes] = await Promise.all([
      // Datos de la clínica (nombre, dirección, teléfono, precio)
      supabaseAdmin
        .from('clinics')
        .select('name, address, phone, consultation_price, whatsapp_phone_id')
        .eq('id', clinicId)
        .single(),
      // Al menos 1 doctor activo
      supabaseAdmin
        .from('doctors')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('is_active', true),
      // Al menos 1 tipo de consulta activo
      supabaseAdmin
        .from('consultation_types')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('is_active', true),
      // Al menos 2 usuarios (admin + 1 más) — paso opcional
      supabaseAdmin
        .from('clinic_users')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('is_active', true),
    ])

    const clinic = clinicRes.data
    if (!clinic) return null

    const clinicDataComplete = Boolean(
      clinic.name?.trim() &&
      clinic.address?.trim() &&
      clinic.phone?.trim() &&
      clinic.consultation_price && clinic.consultation_price > 0
    )
    const doctorsAdded = (doctorsRes.count ?? 0) >= 1
    const consultationTypesAdded = (ctRes.count ?? 0) >= 1
    const whatsappConnected = Boolean(clinic.whatsapp_phone_id?.trim())
    const teamInvited = (usersRes.count ?? 0) >= 2

    const requiredSteps = [clinicDataComplete, doctorsAdded, consultationTypesAdded, whatsappConnected]
    const allRequiredDone = requiredSteps.every(Boolean)

    // Obtener registro existente para comparar completed_at
    const { data: existing } = await supabaseAdmin
      .from('clinic_setup_progress')
      .select('completed_at')
      .eq('clinic_id', clinicId)
      .single()

    const completedAt = allRequiredDone
      ? (existing?.completed_at ?? new Date().toISOString())
      : null

    // Upsert el progreso
    await supabaseAdmin
      .from('clinic_setup_progress')
      .upsert({
        clinic_id: clinicId,
        clinic_data_complete: clinicDataComplete,
        doctors_added: doctorsAdded,
        consultation_types_added: consultationTypesAdded,
        whatsapp_connected: whatsappConnected,
        team_invited: teamInvited,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      })

    return {
      clinic_data_complete: clinicDataComplete,
      doctors_added: doctorsAdded,
      consultation_types_added: consultationTypesAdded,
      whatsapp_connected: whatsappConnected,
      team_invited: teamInvited,
      completed_at: completedAt,
    }
  } catch {
    return null
  }
}
