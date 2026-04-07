// ============================================================
// Admin: Gestión de estado del sistema
// Solo visible para super admin (executive.team@loncocapital.com)
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getSystemStatus } from '@/app/actions/system-status'
import { SystemStatusAdmin } from './system-status-admin'

export default async function SystemStatusPage() {
  const session = await getUserSession()
  if (!session || session.email !== 'executive.team@loncocapital.com') {
    redirect('/dashboard/settings/clinic')
  }

  const components = await getSystemStatus()

  return <SystemStatusAdmin components={components} />
}
