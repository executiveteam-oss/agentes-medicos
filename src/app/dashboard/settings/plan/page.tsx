// ============================================================
// Página de settings: Mi Plan — features y plan actual
// ============================================================

import { getPlanData } from '@/app/actions/feature-config'
import { PlanSettingsForm } from './plan-settings-form'

export default async function PlanSettingsPage() {
  const data = await getPlanData()

  if (!data) {
    return <p className="text-sm text-slate-500">Error cargando datos del plan.</p>
  }

  return <PlanSettingsForm data={data} />
}
