// ============================================================
// Gestión de usuarios del consultorio
// Ruta: /dashboard/settings/users
// ============================================================

export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { getClinicUsers, getPendingInvitations } from '@/app/actions/users'
import { getClinicRoles } from '@/app/actions/roles'
import { UsersPanel } from './users-panel'

export default async function UsersPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const [users, roles, pendingInvitations] = await Promise.all([
    getClinicUsers(),
    getClinicRoles(),
    getPendingInvitations(),
  ])

  // Cargar doctores activos SIN usuario vinculado (para el selector de invitación)
  const { data: allDoctors } = await supabaseAdmin
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', session.clinicId)
    .eq('is_active', true)
    .order('name')

  // Filtrar doctores que ya tienen un clinic_user con doctor_id
  const { data: linkedDoctorIds } = await supabaseAdmin
    .from('clinic_users')
    .select('doctor_id')
    .eq('clinic_id', session.clinicId)
    .not('doctor_id', 'is', null)

  const linkedSet = new Set((linkedDoctorIds ?? []).map((r) => (r as { doctor_id: string }).doctor_id))
  const doctors = (allDoctors ?? []).filter((d) => !linkedSet.has(d.id))

  return (
    <UsersPanel
      users={users}
      roles={roles}
      doctors={(doctors ?? []) as { id: string; name: string }[]}
      pendingInvitations={pendingInvitations}
    />
  )
}
