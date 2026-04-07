// ============================================================
// Gestión de roles y permisos
// Ruta: /dashboard/settings/roles
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { getClinicRoles } from '@/app/actions/roles'
import { RolesEditor } from './roles-editor'

export default async function RolesPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const roles = await getClinicRoles()

  return <RolesEditor roles={roles as Parameters<typeof RolesEditor>[0]['roles']} />
}
