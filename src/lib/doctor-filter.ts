// ============================================================
// Doctor-level data isolation helpers
//
// Cuando el usuario tiene rol "Doctor" y un doctor_id vinculado,
// estas funciones agregan filtros automáticos a las queries.
// ============================================================

import type { UserSession } from '@/types/permissions'

/**
 * Retorna true si el usuario tiene rol Doctor y un doctor vinculado.
 */
export function isDoctorRole(session: UserSession): boolean {
  return session.role.name === 'Doctor' && !!session.doctorId
}

/**
 * Retorna el doctor_id si el usuario tiene rol Doctor.
 * Retorna null para roles con acceso completo (Admin, Coordinador, etc.)
 */
export function getRestrictedDoctorId(session: UserSession): string | null {
  if (isDoctorRole(session)) return session.doctorId
  return null
}

/**
 * Retorna true si el usuario es Doctor pero no tiene doctor_id vinculado.
 * En este caso debe ver un mensaje de "contacta al admin".
 */
export function isDoctorUnlinked(session: UserSession): boolean {
  return session.role.name === 'Doctor' && !session.doctorId
}
