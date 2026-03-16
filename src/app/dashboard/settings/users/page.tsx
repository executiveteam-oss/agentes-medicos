// ============================================================
// Gestión de usuarios del consultorio
// Ruta: /dashboard/settings/users
// ============================================================

export const dynamic = 'force-dynamic'

import { getClinicUsers } from '@/app/actions/users'
import { getClinicRoles } from '@/app/actions/roles'
import { UsersPanel } from './users-panel'

export default async function UsersPage() {
  const [users, roles] = await Promise.all([
    getClinicUsers(),
    getClinicRoles(),
  ])

  return <UsersPanel users={users} roles={roles} />
}
