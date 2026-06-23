// ============================================================
// Helpers para server actions: obtener clinic_id del usuario
// autenticado y verificar permisos de escritura por módulo
// ============================================================

import { getUserSession } from '@/lib/session'
import type { ModuleKey } from '@/types/permissions'

const NOT_AUTHENTICATED_MSG = 'No autenticado. Por favor inicia sesión.'
// Mensajes user-friendly de permisos — pensados para mostrar directo al usuario
// sin filtros (ej. en toast). El UI captura via isPermissionError() y los renderea.
const NO_WRITE_PERMISSION_MSG = 'Tu rol no tiene permiso para editar esto. Pedile al administrador del consultorio que actualice tus permisos.'
const NO_READ_PERMISSION_MSG = 'Tu rol no tiene permiso para ver esta sección. Pedile al administrador del consultorio.'

/**
 * Obtiene el clinic_id del usuario autenticado.
 * Lanza error 401 si no hay sesión activa.
 */
export async function getSessionClinicId(): Promise<string> {
  const session = await getUserSession()
  if (!session) {
    throw new Error(NOT_AUTHENTICATED_MSG)
  }
  return session.clinicId
}

/**
 * Verifica que el usuario tenga permiso de escritura en un módulo.
 * Lanza error 403 con mensaje user-friendly si no tiene permiso.
 */
export async function checkWritePermission(module: ModuleKey): Promise<string> {
  const session = await getUserSession()
  if (!session) {
    throw new Error(NOT_AUTHENTICATED_MSG)
  }
  const perm = session.permissions[module]
  if (!perm?.write) {
    throw new Error(NO_WRITE_PERMISSION_MSG)
  }
  return session.clinicId
}

/**
 * Verifica que el usuario tenga permiso de lectura en un módulo.
 * Lanza error 403 con mensaje user-friendly si no tiene permiso.
 */
export async function checkReadPermission(module: ModuleKey): Promise<string> {
  const session = await getUserSession()
  if (!session) {
    throw new Error(NOT_AUTHENTICATED_MSG)
  }
  const perm = session.permissions[module]
  if (!perm?.read) {
    throw new Error(NO_READ_PERMISSION_MSG)
  }
  return session.clinicId
}

/**
 * Detecta si un error capturado proviene de checkWritePermission / checkReadPermission.
 * Útil en server actions para preservar el mensaje al usuario en vez de devolver
 * un genérico "Error inesperado".
 *
 * Uso típico:
 *   } catch (err) {
 *     return { ok: false, error: extractActionError(err) }
 *   }
 */
export function extractActionError(err: unknown): string {
  if (err instanceof Error) {
    if (
      err.message === NO_WRITE_PERMISSION_MSG ||
      err.message === NO_READ_PERMISSION_MSG ||
      err.message === NOT_AUTHENTICATED_MSG
    ) {
      return err.message
    }
  }
  return 'Error inesperado. Probá refrescar la página.'
}
