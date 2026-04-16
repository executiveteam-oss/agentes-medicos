// ============================================================
// Importar tipos de consulta desde iSalud — Onboarding helper
// Ruta: /dashboard/settings/import-isalud
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { getStagingProducts, getStagingCount } from '@/app/actions/isalud-convenios'
import { ImportIsaludPanel } from './import-isalud-panel'

export default async function ImportIsaludPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const status = await getStagingCount()

  // Si ya hay datos en staging, cargarlos
  const stagingData = status.count > 0 ? await getStagingProducts() : null

  return (
    <ImportIsaludPanel
      hasIsalud={status.hasIsalud}
      initialStagingData={stagingData}
    />
  )
}
