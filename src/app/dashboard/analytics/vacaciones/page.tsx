// ============================================================
// Planificación de vacaciones — Basada en demanda histórica
// Ruta: /dashboard/analytics/vacaciones
// ============================================================

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { getVacationData, getVacationMessage } from '@/app/actions/vacation'
import { VacationPanel } from '@/components/dashboard/vacation-panel'

export default async function VacacionesPage() {
  const [data, vacationMessage] = await Promise.all([
    getVacationData(),
    getVacationMessage(),
  ])

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/dashboard/analytics" className="text-blue-700 hover:text-blue-800 hover:underline">
          Estadísticas
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-500">Planificar vacaciones</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          ¿Cuándo tomar vacaciones?
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Basado en tu historial de demanda, estas son las semanas con menos pacientes
        </p>
      </div>

      {/* Info banner */}
      <div className="card p-4 bg-blue-50/50 border-blue-200">
        <p className="text-sm text-blue-800">
          Analizamos <strong>{data.totalWeeksAnalyzed}</strong> semanas de datos para encontrar
          los mejores momentos para descansar sin afectar tus ingresos.
        </p>
      </div>

      {/* Interactive panel */}
      <VacationPanel
        weeks={data.weeks}
        suggestions={data.suggestions}
        overallAvg={data.overallAvg}
        initialVacationMessage={vacationMessage}
      />
    </div>
  )
}
