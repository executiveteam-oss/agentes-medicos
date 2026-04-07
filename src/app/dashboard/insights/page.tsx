// ============================================================
// Omuwan Insights — Recomendaciones IA de rentabilidad
// Ruta: /dashboard/insights
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import {
  getLatestInsights,
  getTodayInsight,
  getInsightDataSufficiency,
} from '@/app/actions/insights'
import { InsightsContent } from './insights-content'
import { getFeatureGate, isFeatureEnabled } from '@/lib/feature-gate'
import { FeatureLocked } from '@/components/dashboard/feature-locked'

export default async function InsightsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard')

  const gate = await getFeatureGate(session.clinicId)
  if (!isFeatureEnabled(gate.config, 'insights')) {
    return (
      <FeatureLocked
        featureName="Insights de rentabilidad"
        featureDescription="Tu consultor de rentabilidad diario — recomendaciones específicas basadas en los datos reales de tu consultorio."
        whatsappMessage="quiero activar Insights de rentabilidad"
        clinicName={session.clinic?.name}
        plusModuleName="Insights de rentabilidad"
        doctorCount={gate.expectedDoctors}
      />
    )
  }

  const [insights, todayInsight, dataSufficiency] = await Promise.all([
    getLatestInsights(),
    getTodayInsight(),
    getInsightDataSufficiency(),
  ])

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Hero header */}
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-slate-900">
            Tu consultor de élite
          </h1>
          <p className="text-[#1e3a5f] text-base lg:text-lg mt-2 max-w-2xl leading-relaxed">
            El mismo análisis que pagarías $2.000.000/hora en una firma de consultoría
            — automatizado, personalizado y actualizado cada mañana con los datos reales
            de tu consultorio.
          </p>
        </div>

        {/* Value props */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl">📊</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Análisis de tus datos reales</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  No benchmarks genéricos — tus números, tus patrones, tus oportunidades.
                </p>
              </div>
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💰</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Impacto en COP, siempre</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Cada recomendación tiene un valor económico concreto. Sabes exactamente
                  cuánto ganas si actúas.
                </p>
              </div>
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🎯</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Acción inmediata</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  No reportes para leer después. Un botón que te lleva directo a resolverlo.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <InsightsContent
        insights={insights}
        todayInsight={todayInsight}
        dataSufficiency={dataSufficiency}
      />
    </div>
  )
}
