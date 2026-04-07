'use client'

// ============================================================
// Formulario de configuración: Mi Plan — toggles de features
// ============================================================

import { useState, useTransition } from 'react'
import { toggleFeature } from '@/app/actions/feature-config'
import type { PlanData } from '@/app/actions/feature-config'
import type { FeatureConfig } from '@/types/database'

const PLAN_LABELS: Record<string, string> = {
  basic: 'Core',
  pro: 'Core',
  core: 'Core',
}

const PLAN_DISPLAY: Record<string, string> = {
  core: 'Core',
  basico: 'Core',
  pro: 'Core',
  clinica: 'Core',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  trial: { label: 'Prueba gratuita', color: 'bg-blue-100 text-blue-700' },
  active: { label: 'Activo', color: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-700' },
  expired: { label: 'Expirado', color: 'bg-slate-100 text-slate-700' },
}

interface FeatureItem {
  key: keyof FeatureConfig
  label: string
  description: string
  locked: boolean // No se puede desactivar
}

const FEATURES: FeatureItem[] = [
  { key: 'agent', label: 'Agente IA WhatsApp', description: 'Atiende pacientes por WhatsApp 24/7', locked: true },
  { key: 'reminders_24h', label: 'Recordatorio 24h', description: 'Envía recordatorio automático 24 horas antes de la cita', locked: true },
  { key: 'reminders_72h', label: 'Recordatorio 72h', description: 'Recordatorio adicional 3 días antes de la cita', locked: true },
  { key: 'docs_required', label: 'Documentos requeridos', description: 'Solicita documentos previos automáticamente', locked: true },
  { key: 'waitlist', label: 'Lista de espera', description: 'Gestión de pacientes en espera cuando no hay disponibilidad', locked: true },
  { key: 'dashboard', label: 'Dashboard', description: 'Panel de control con métricas del consultorio', locked: true },
  { key: 'reactivation', label: 'Reactivación de pacientes', description: 'Contacta automáticamente pacientes inactivos — módulo Plus', locked: false },
  { key: 'insights', label: 'Insights IA', description: 'Análisis inteligente con recomendaciones automáticas — módulo Plus', locked: false },
  { key: 'virtual', label: 'Consultas virtuales', description: 'Soporte para consultas por videollamada — módulo Plus', locked: false },
  { key: 'vacations', label: 'Planificación de vacaciones', description: 'Bloqueo de agenda con redistribución de citas — módulo Plus', locked: false },
  { key: 'ai_assistant', label: 'Asistente IA dashboard', description: 'Consultor IA interactivo dentro del dashboard — módulo Plus', locked: false },
  { key: 'cartera', label: 'Control de cartera', description: 'Cartera vencida, pagos pendientes y cuentas por cobrar — módulo Plus', locked: false },
  { key: 'facturacion', label: 'Facturación', description: 'Facturación interna del consultorio — módulo Plus', locked: false },
  { key: 'estadisticas', label: 'Estadísticas avanzadas', description: 'Métricas de ocupación, no-shows e ingresos — módulo Plus', locked: false },
]

interface Props {
  data: PlanData
}

export function PlanSettingsForm({ data }: Props) {
  const [features, setFeatures] = useState<FeatureConfig>(data.featureConfig)
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)

  function handleToggle(featureKey: keyof FeatureConfig) {
    const newValue = !features[featureKey]
    setFeedback(null)

    // Optimistic update
    setFeatures(prev => ({ ...prev, [featureKey]: newValue }))

    startTransition(async () => {
      const result = await toggleFeature(featureKey, newValue)
      if (!result.ok) {
        // Revert
        setFeatures(prev => ({ ...prev, [featureKey]: !newValue }))
        setFeedback(result.error ?? 'Error')
      } else {
        setFeedback('Configuración actualizada')
        setTimeout(() => setFeedback(null), 3000)
      }
    })
  }

  const statusInfo = STATUS_LABELS[data.subscriptionStatus] ?? STATUS_LABELS.trial
  const planLabel = data.preferredPlan
    ? PLAN_DISPLAY[data.preferredPlan] ?? data.preferredPlan
    : PLAN_LABELS[data.subscriptionPlan] ?? data.subscriptionPlan

  const activeCount = Object.values(features).filter(Boolean).length
  const totalCount = Object.keys(features).length

  return (
    <div className="space-y-6">
      {/* Plan actual */}
      <div className="card p-5">
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
          <div className="w-12 h-12 rounded-xl bg-[#0f2a6e] flex items-center justify-center">
            <span className="text-white font-bold text-lg">{planLabel[0]}</span>
          </div>
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

      {/* Features */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Funciones</h3>
        <p className="text-xs text-slate-400 mb-5">
          Activa o desactiva funciones de tu plan. Los cambios se aplican inmediatamente.
        </p>

        <div className="space-y-3">
          {FEATURES.map((feat) => {
            const isActive = features[feat.key]
            return (
              <div
                key={feat.key}
                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  isActive ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${isActive ? 'text-slate-900' : 'text-slate-500'}`}>
                      {feat.label}
                    </p>
                    {feat.locked && (
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                        Incluido
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{feat.description}</p>
                </div>

                {feat.locked ? (
                  <div className="w-10 h-6 rounded-full bg-emerald-500 flex items-center justify-end px-0.5 shrink-0">
                    <div className="w-5 h-5 rounded-full bg-white" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleToggle(feat.key)}
                    disabled={isPending}
                    className={`w-10 h-6 rounded-full flex items-center px-0.5 shrink-0 transition-colors ${
                      isActive ? 'bg-emerald-500 justify-end' : 'bg-slate-300 justify-start'
                    } ${isPending ? 'opacity-60' : ''}`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-sm" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {feedback && (
          <p className={`mt-4 text-sm font-medium ${feedback.includes('Error') ? 'text-red-600' : 'text-emerald-600'}`}>
            {feedback}
          </p>
        )}
      </div>
    </div>
  )
}
