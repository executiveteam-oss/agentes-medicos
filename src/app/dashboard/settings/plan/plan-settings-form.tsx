'use client'

// ============================================================
// Mi Plan — Vista de features Core + módulos Plus
// Sin auto-activación: Plus se activa vía WhatsApp (manual)
// ============================================================

import type { PlanData } from '@/app/actions/feature-config'
import type { FeatureConfig } from '@/types/database'

const UPGRADE_PHONE = '573015525881'

const PLAN_LABELS: Record<string, string> = {
  basic: 'Core', pro: 'Core', core: 'Core',
}
const PLAN_DISPLAY: Record<string, string> = {
  core: 'Core', basico: 'Core', pro: 'Core', clinica: 'Core',
}
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  trial: { label: 'Prueba gratuita', color: 'bg-blue-100 text-blue-700' },
  active: { label: 'Activo', color: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-700' },
  expired: { label: 'Expirado', color: 'bg-slate-100 text-slate-700' },
}

// Precios Plus por módulo y rango de médicos [1, 2-3, 4-6, 7-10]
const PLUS_PRICES: Record<string, number[]> = {
  'Reactivación de pacientes':     [75_000, 120_000, 165_000, 220_000],
  'Consultas virtuales':           [65_000, 100_000, 140_000, 185_000],
  'Planificación de vacaciones':   [40_000,  65_000,  90_000, 120_000],
  'Asistente IA dashboard':        [45_000,  70_000,  95_000, 120_000],
}

function getDoctorTierIndex(n: number | null): number {
  if (!n || n <= 1) return 0
  if (n <= 3) return 1
  if (n <= 6) return 2
  return 3
}

function formatCOP(n: number): string {
  return '$' + n.toLocaleString('es-CO')
}

interface FeatureItem {
  key: keyof FeatureConfig
  label: string
  description: string
  core: boolean        // true = incluido en Core, false = módulo Plus
  plusName?: string     // Nombre para buscar precio en PLUS_PRICES
}

const FEATURES: FeatureItem[] = [
  // Core
  { key: 'agent', label: 'Agente IA WhatsApp', description: 'Atiende pacientes por WhatsApp 24/7', core: true },
  { key: 'reminders_24h', label: 'Recordatorio 24h', description: 'Recordatorio automático 24 horas antes de la cita', core: true },
  { key: 'reminders_72h', label: 'Recordatorio 72h', description: 'Recordatorio adicional 3 días antes de la cita', core: true },
  { key: 'docs_required', label: 'Documentos requeridos', description: 'Solicita documentos previos automáticamente', core: true },
  { key: 'waitlist', label: 'Lista de espera', description: 'Gestión de pacientes en espera', core: true },
  { key: 'dashboard', label: 'Dashboard', description: 'Panel de control con agenda y pacientes', core: true },
  // Plus
  { key: 'reactivation', label: 'Reactivación de pacientes', description: 'Contacta automáticamente pacientes inactivos', core: false, plusName: 'Reactivación de pacientes' },
  { key: 'virtual', label: 'Consultas virtuales', description: 'Videollamadas con link automático', core: false, plusName: 'Consultas virtuales' },
  { key: 'vacations', label: 'Planificación de vacaciones', description: 'Bloqueo de agenda con redistribución de citas', core: false, plusName: 'Planificación de vacaciones' },
]

interface Props {
  data: PlanData
}

export function PlanSettingsForm({ data }: Props) {
  const statusInfo = STATUS_LABELS[data.subscriptionStatus] ?? STATUS_LABELS.trial
  const planLabel = data.preferredPlan
    ? PLAN_DISPLAY[data.preferredPlan] ?? data.preferredPlan
    : PLAN_LABELS[data.subscriptionPlan] ?? data.subscriptionPlan

  const tierIndex = getDoctorTierIndex(data.expectedDoctors)
  const coreFeatures = FEATURES.filter((f) => f.core)
  const plusFeatures = FEATURES.filter((f) => !f.core)
  const activeCount = Object.values(data.featureConfig).filter(Boolean).length
  const totalCount = Object.keys(data.featureConfig).length

  function buildWaUrl(moduleName: string, price: number | null) {
    const priceText = price ? ` (${formatCOP(price)}/mes)` : ''
    const msg = `Hola, soy ${data.clinicName} y quiero activar ${moduleName} en mi plan de Omuwan${priceText}`
    return `https://wa.me/${UPGRADE_PHONE}?text=${encodeURIComponent(msg)}`
  }

  return (
    <div className="space-y-6">
      {/* Plan actual */}
      <div className="card-v2 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Tu plan actual</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeCount} de {totalCount} funciones activas
            </p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        </div>

        <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/omuwan-logo.png" alt="Omuwan" className="w-12 h-12 rounded-xl" />
          <div>
            <p className="text-lg font-semibold text-slate-900">Plan {planLabel}</p>
            <div className="flex gap-3 text-xs text-slate-500 mt-0.5">
              {data.expectedDoctors && <span>{data.expectedDoctors} médico{data.expectedDoctors !== 1 ? 's' : ''}</span>}
              {data.expectedMonthlyAppointments && <span>{data.expectedMonthlyAppointments} citas/mes</span>}
            </div>
          </div>
        </div>

        <a
          href="https://wa.me/573015525881?text=Hola%2C%20quiero%20cambiar%20mi%20plan%20de%20Omuwan"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 w-full btn-secondary text-sm text-center block"
        >
          Cambiar plan por WhatsApp
        </a>
      </div>

      {/* Core features */}
      <div className="card-v2 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Incluido en tu plan Core</h3>
        <p className="text-xs text-slate-400 mb-4">Estas funciones están siempre activas.</p>

        <div className="space-y-2">
          {coreFeatures.map((feat) => (
            <div key={feat.key} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white">
              <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{feat.label}</p>
                <p className="text-xs text-slate-400">{feat.description}</p>
              </div>
              <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full shrink-0 font-medium">
                Incluido
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Plus modules */}
      <div className="card-v2 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Módulos Plus</h3>
        <p className="text-xs text-slate-400 mb-4">Activa módulos adicionales para potenciar tu consultorio.</p>

        <div className="space-y-3">
          {plusFeatures.map((feat) => {
            const isActive = data.featureConfig[feat.key]
            const prices = feat.plusName ? PLUS_PRICES[feat.plusName] : null
            const price = prices ? prices[tierIndex] : null

            if (isActive) {
              return (
                <div key={feat.key} className="flex items-center gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50/50">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{feat.label}</p>
                    <p className="text-xs text-slate-400">{feat.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                      Activo
                    </span>
                    <p className="text-[10px] text-slate-400 mt-1">Para desactivar contacta soporte</p>
                  </div>
                </div>
              )
            }

            return (
              <div key={feat.key} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700">{feat.label}</p>
                    <p className="text-xs text-slate-400">{feat.description}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <a
                    href={buildWaUrl(feat.label, price)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-[#028090] hover:bg-[#026d7a] text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Activar{price ? ` — ${formatCOP(price)}/mes` : ''}
                  </a>
                  <span className="text-[10px] text-slate-400">
                    Te confirmamos en menos de 2 horas por WhatsApp.
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
