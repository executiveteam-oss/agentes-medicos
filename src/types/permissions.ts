// ============================================================
// Tipos de permisos del sistema de roles
// 12 módulos, cada uno con permisos de lectura y escritura
// ============================================================

export const MODULES = [
  'agenda',
  'noshow',
  'espera',
  'patients',
  'conversations',
  'analytics',
  'whatsapp',
  'settings',
  'onboarding',
  'user_management',
] as const

export type ModuleKey = typeof MODULES[number]

export interface ModulePermission {
  read: boolean
  write: boolean
}

export type Permissions = Record<ModuleKey, ModulePermission>

// Permisos vacíos (sin acceso a nada)
export function emptyPermissions(): Permissions {
  return Object.fromEntries(
    MODULES.map((m) => [m, { read: false, write: false }])
  ) as Permissions
}

// Sesión completa del usuario autenticado
export interface UserSession {
  authUserId: string
  clinicUserId: string
  clinicId: string
  fullName: string
  email: string
  doctorId: string | null      // Si el usuario tiene rol Doctor, su doctor_id vinculado
  role: {
    id: string
    name: string
  }
  permissions: Permissions
  /**
   * Bloque 4 — permiso separado para aprobar/rechazar autorizaciones direccionadas.
   * Lectura semánticamente más sensible que el flag genérico de conversaciones.
   * Por defecto: Admin, Coordinadora y Secretaria; Doctor y Contador no.
   * Lady puede ajustar en la UI de roles.
   */
  authorizationsReview: boolean
  clinic: {
    id: string
    name: string
    specialty: string[]
    onboarded_at: string | null
  }
}
