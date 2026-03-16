// ============================================================
// Helpers para server actions: obtener clinic_id del usuario
// autenticado y verificar permisos de escritura por módulo
// ============================================================

import { getUserSession } from '@/lib/session'
import type { ModuleKey } from '@/types/permissions'

/**
 * Obtiene el clinic_id del usuario autenticado.
 * Lanza error 401 si no hay sesión activa.
 */
export async function getSessionClinicId(): Promise<string> {
  const session = await getUserSession()
  if (!session) {
    throw new Error('No autenticado. Por favor inicia sesión.')
  }
  return session.clinicId
}

/**
 * Verifica que el usuario tenga permiso de escritura en un módulo.
 * Lanza error 403 si no tiene permiso.
 */
export async function checkWritePermission(module: ModuleKey): Promise<string> {
  const session = await getUserSession()
  if (!session) {
    throw new Error('No autenticado. Por favor inicia sesión.')
  }
  const perm = session.permissions[module]
  if (!perm?.write) {
    throw new Error(`Sin permiso de escritura en el módulo: ${module}`)
  }
  return session.clinicId
}

/**
 * Verifica que el usuario tenga permiso de lectura en un módulo.
 * Lanza error 403 si no tiene permiso.
 */
export async function checkReadPermission(module: ModuleKey): Promise<string> {
  const session = await getUserSession()
  if (!session) {
    throw new Error('No autenticado. Por favor inicia sesión.')
  }
  const perm = session.permissions[module]
  if (!perm?.read) {
    throw new Error(`Sin permiso de lectura en el módulo: ${module}`)
  }
  return session.clinicId
}
