'use client'

// ============================================================
// Widget: Guía de activación post-onboarding
// Muestra checklist de pasos para configurar el consultorio
// Se colapsa y desaparece 3 días después de completar todo
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import type { SetupProgress } from '@/app/actions/setup-progress'

interface Props {
  progress: SetupProgress
}

interface Step {
  key: keyof Omit<SetupProgress, 'completed_at'>
  label: string
  href: string
  optional?: boolean
}

const STEPS: Step[] = [
  { key: 'clinic_data_complete', label: 'Completa los datos del consultorio', href: '/dashboard/settings/clinic' },
  { key: 'doctors_added', label: 'Agrega tus médicos', href: '/dashboard/settings/whatsapp' },
  { key: 'consultation_types_added', label: 'Configura tipos de consulta', href: '/dashboard/settings/whatsapp' },
  { key: 'whatsapp_connected', label: 'Conecta WhatsApp', href: '/dashboard/settings/whatsapp' },
  { key: 'team_invited', label: 'Invita a tu equipo', href: '/dashboard/settings/users', optional: true },
]

export function SetupChecklist({ progress }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  // Si se completó hace más de 3 días, no mostrar
  if (progress.completed_at) {
    const completedDate = new Date(progress.completed_at)
    const threeDaysLater = new Date(completedDate.getTime() + 3 * 24 * 60 * 60 * 1000)
    if (new Date() > threeDaysLater) return null
  }

  const completedCount = STEPS.filter((s) => progress[s.key]).length
  const totalSteps = STEPS.length
  const percentage = Math.round((completedCount / totalSteps) * 100)
  const allRequiredDone = progress.completed_at !== null

  return (
    <div className="card border-blue-200 bg-gradient-to-r from-blue-50 to-white overflow-hidden">
      {/* Header — siempre visible, click para colapsar */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-5 py-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{allRequiredDone ? '🎉' : '⚡'}</span>
          <div>
            {allRequiredDone ? (
              <p className="text-sm font-semibold text-emerald-700">
                ¡Tu consultorio está listo! Tu agente de WhatsApp está activo.
              </p>
            ) : (
              <p className="text-sm font-semibold text-slate-900">
                Activa tu consultorio — {completedCount}/{totalSteps} pasos
              </p>
            )}
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Progress bar */}
      <div className="px-5 pb-1">
        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Steps — colapsable */}
      {!collapsed && (
        <div className="px-5 pb-5 pt-3 space-y-2">
          {STEPS.map((step) => {
            const done = progress[step.key]
            return (
              <div key={step.key} className="flex items-center gap-3">
                {done ? (
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs flex-shrink-0">
                    ✓
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded border-2 border-slate-300 flex-shrink-0" />
                )}

                {done ? (
                  <span className="text-sm text-slate-400 line-through">{step.label}</span>
                ) : (
                  <Link
                    href={step.href}
                    className="text-sm text-blue-700 hover:text-blue-900 font-medium hover:underline"
                  >
                    {step.label}
                  </Link>
                )}

                {step.optional && !done && (
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded">
                    Opcional
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
