// ============================================================
// Seed de roles predefinidos para una clínica nueva
// Se ejecuta al registrar una nueva clínica (server-side)
// 5 roles: Admin, Doctor, Coordinadora, Secretaria, Contador
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Permissions } from '@/types/permissions'

type RoleDefinition = {
  name: string
  description: string
  permissions: Permissions
  is_default: boolean
}

function perm(read: boolean, write: boolean) {
  return { read, write }
}

const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    name: 'Admin',
    description: 'Acceso total a todos los módulos',
    is_default: false,
    permissions: {
      agenda: perm(true, true),
      noshow: perm(true, true),
      cartera: perm(true, true),
      facturacion: perm(true, true),
      espera: perm(true, true),
      patients: perm(true, true),
      conversations: perm(true, true),
      analytics: perm(true, true),
      whatsapp: perm(true, true),
      settings: perm(true, true),
      onboarding: perm(true, true),
      user_management: perm(true, true),
    },
  },
  {
    name: 'Doctor',
    description: 'Ver agenda, pacientes y estadísticas',
    is_default: false,
    permissions: {
      agenda: perm(true, true),
      noshow: perm(true, false),
      cartera: perm(false, false),
      facturacion: perm(false, false),
      espera: perm(false, false),
      patients: perm(true, false),
      conversations: perm(false, false),
      analytics: perm(true, false),
      whatsapp: perm(false, false),
      settings: perm(false, false),
      onboarding: perm(false, false),
      user_management: perm(false, false),
    },
  },
  {
    name: 'Coordinadora',
    description: 'Gestión completa de agenda, pacientes y asistente IA',
    is_default: true,
    permissions: {
      agenda: perm(true, true),
      noshow: perm(true, true),
      cartera: perm(false, false),
      facturacion: perm(false, false),
      espera: perm(true, true),
      patients: perm(true, true),
      conversations: perm(true, false),
      analytics: perm(true, false),
      whatsapp: perm(true, true),
      settings: perm(false, false),
      onboarding: perm(false, false),
      user_management: perm(false, false),
    },
  },
  {
    name: 'Secretaria',
    description: 'Ver agenda y lista de espera',
    is_default: false,
    permissions: {
      agenda: perm(true, true),
      noshow: perm(false, false),
      cartera: perm(false, false),
      facturacion: perm(false, false),
      espera: perm(true, false),
      patients: perm(true, false),
      conversations: perm(false, false),
      analytics: perm(false, false),
      whatsapp: perm(false, false),
      settings: perm(false, false),
      onboarding: perm(false, false),
      user_management: perm(false, false),
    },
  },
  {
    name: 'Contador',
    description: 'Acceso a cartera, facturación y estadísticas financieras',
    is_default: false,
    permissions: {
      agenda: perm(false, false),
      noshow: perm(false, false),
      cartera: perm(true, true),
      facturacion: perm(true, true),
      espera: perm(false, false),
      patients: perm(false, false),
      conversations: perm(false, false),
      analytics: perm(true, false),
      whatsapp: perm(false, false),
      settings: perm(false, false),
      onboarding: perm(false, false),
      user_management: perm(false, false),
    },
  },
]

/**
 * Crea los 5 roles predefinidos para una clínica nueva.
 * Retorna el ID del rol Admin (para asignarlo al usuario fundador).
 */
export async function seedDefaultRoles(clinicId: string): Promise<string> {
  const rolesToInsert = ROLE_DEFINITIONS.map((r) => ({
    ...r,
    clinic_id: clinicId,
  }))

  const { data, error } = await supabaseAdmin
    .from('clinic_roles')
    .insert(rolesToInsert)
    .select('id, name')

  if (error) throw new Error(`Error creando roles: ${error.message}`)

  const adminRole = data?.find((r) => r.name === 'Admin')
  if (!adminRole) throw new Error('No se encontró el rol Admin después de crearlo')

  return adminRole.id
}
