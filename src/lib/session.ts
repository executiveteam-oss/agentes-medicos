// ============================================================
// Sesión del usuario autenticado
// Usa supabaseAdmin (service role) para leer clinic_users y roles
// evitando el problema de RLS circular en el middleware
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserSession, Permissions } from '@/types/permissions'
import { emptyPermissions } from '@/types/permissions'

/**
 * Obtiene la sesión completa del usuario autenticado.
 * Retorna null si no hay sesión activa o si el usuario no está vinculado a ninguna clínica.
 */
export async function getUserSession(): Promise<UserSession | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) return null

    // Usar supabaseAdmin para evitar problemas de RLS circular
    // (clinic_users se consulta para saber si el usuario tiene acceso,
    // pero la política de RLS de clinic_users también requiere estar en clinic_users)
    const { data: clinicUser } = await supabaseAdmin
      .from('clinic_users')
      .select(`
        id,
        clinic_id,
        full_name,
        is_active,
        role_id,
        doctor_id,
        clinic_roles (
          id,
          name,
          permissions
        ),
        clinics (
          id,
          name,
          specialty,
          onboarded_at
        )
      `)
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (!clinicUser) return null

    const roleRaw = Array.isArray(clinicUser.clinic_roles)
      ? clinicUser.clinic_roles[0] ?? null
      : clinicUser.clinic_roles
    const role = roleRaw as { id: string; name: string; permissions: Permissions } | null

    const clinicRaw = Array.isArray(clinicUser.clinics)
      ? clinicUser.clinics[0] ?? null
      : clinicUser.clinics
    const clinic = clinicRaw as { id: string; name: string; specialty: string[]; onboarded_at: string | null } | null

    if (!clinic) return null

    // Merge stored permissions with empty defaults so newly added modules
    // (e.g. 'whatsapp') don't crash when the DB role was seeded before the module existed
    const stored = role?.permissions ?? emptyPermissions()
    const base = emptyPermissions()
    const permissions: Permissions = { ...base, ...stored }

    return {
      authUserId: user.id,
      clinicUserId: clinicUser.id,
      clinicId: clinicUser.clinic_id,
      fullName: clinicUser.full_name,
      email: user.email ?? '',
      doctorId: (clinicUser as Record<string, unknown>).doctor_id as string | null ?? null,
      role: {
        id: role?.id ?? '',
        name: role?.name ?? 'Sin rol',
      },
      permissions,
      clinic: {
        id: clinic.id,
        name: clinic.name,
        specialty: clinic.specialty,
        onboarded_at: clinic.onboarded_at,
      },
    }
  } catch {
    return null
  }
}
