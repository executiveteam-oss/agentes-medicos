// ============================================================
// Gestión de usuarios del consultorio
// Ruta: /dashboard/settings/users
// ============================================================

export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getClinicUsers } from '@/app/actions/users'
import { getClinicRoles } from '@/app/actions/roles'
import { UsersPanel } from './users-panel'

export default async function UsersPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')

  const [users, roles] = await Promise.all([
    getClinicUsers(),
    getClinicRoles(),
  ])

  // Cargar doctores activos para el selector "Médico vinculado"
  const { data: doctors } = await supabaseAdmin
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', session.clinicId)
    .eq('is_active', true)
    .order('name')

  return <UsersPanel users={users} roles={roles} doctors={(doctors ?? []) as { id: string; name: string }[]} />
}
