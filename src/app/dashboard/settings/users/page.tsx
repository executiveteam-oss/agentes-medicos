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
import { ClaimConfigForm } from '@/components/dashboard/claim-config-form'
import { parseClaimConfig } from '@/lib/rules/claim-logic'
import { Users } from 'lucide-react'

export default async function UsersPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const [users, roles, pendingInvitations, clinicForClaim] = await Promise.all([
    getClinicUsers(),
    getClinicRoles(),
    getPendingInvitations(),
    supabaseAdmin.from('clinics').select('feature_config').eq('id', session.clinicId).single(),
  ])
  const claimConfig = parseClaimConfig(
    (clinicForClaim.data as { feature_config: unknown } | null)?.feature_config
  )

  // Cargar doctores activos SIN usuario vinculado (para el selector de invitación)
  const { data: allDoctors } = await supabaseAdmin
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', session.clinicId)
    .eq('is_active', true)
    .order('name')

  // Filtrar doctores que YA tienen un clinic_user con doctor_id...
  const { data: linkedDoctorIds } = await supabaseAdmin
    .from('clinic_users')
    .select('doctor_id')
    .eq('clinic_id', session.clinicId)
    .not('doctor_id', 'is', null)

  // ...o una invitación PENDIENTE (aún no aceptada, no vencida) con ese médico.
  // Sin esto, dos invitaciones podrían apuntar al mismo médico y la segunda
  // quedaría sin vincular al aceptar (accept-invite omite el doble-vínculo).
  const { data: pendingDoctorIds } = await supabaseAdmin
    .from('invitations')
    .select('doctor_id')
    .eq('clinic_id', session.clinicId)
    .is('accepted_at', null)
    .not('doctor_id', 'is', null)
    .gt('expires_at', new Date().toISOString())

  const linkedSet = new Set<string>([
    ...(linkedDoctorIds ?? []).map((r) => (r as { doctor_id: string }).doctor_id),
    ...(pendingDoctorIds ?? []).map((r) => (r as { doctor_id: string }).doctor_id),
  ])
  const doctors = (allDoctors ?? []).filter((d) => !linkedSet.has(d.id))

  return (
    <>
      <div style={{ marginBottom: '20px' }}>
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Users size={18} /> Equipo
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Miembros del consultorio, invitaciones y coordinación de conversaciones
        </p>
      </div>

      <ClaimConfigForm initial={claimConfig} />

      <UsersPanel
        users={users}
        roles={roles}
        doctors={(doctors ?? []) as { id: string; name: string }[]}
        pendingInvitations={pendingInvitations}
      />
    </>
  )
}
