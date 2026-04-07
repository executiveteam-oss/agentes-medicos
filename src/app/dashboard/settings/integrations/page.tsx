// ============================================================
// Página Integraciones — Conecta Omuwan con sistemas externos
// Ruta: /dashboard/settings/integrations
// ============================================================

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { getIntegrationsConfig } from '@/app/actions/integrations'
import { IntegrationsPanel } from './integrations-panel'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const config = await getIntegrationsConfig()

  return <IntegrationsPanel config={config} />
}
