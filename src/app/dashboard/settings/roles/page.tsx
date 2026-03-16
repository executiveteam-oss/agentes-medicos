// ============================================================
// Gestión de roles y permisos
// Ruta: /dashboard/settings/roles
// ============================================================

export const dynamic = 'force-dynamic'

import { getClinicRoles } from '@/app/actions/roles'
import { RolesEditor } from './roles-editor'

export default async function RolesPage() {
  const roles = await getClinicRoles()

  return <RolesEditor roles={roles as Parameters<typeof RolesEditor>[0]['roles']} />
}
