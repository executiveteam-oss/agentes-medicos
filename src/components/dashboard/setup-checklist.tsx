'use client'

// ============================================================
// Widget: Guia de activacion post-onboarding (v2)
// Muestra checklist de pasos para configurar el consultorio
// Se colapsa y desaparece 3 dias despues de completar todo
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Check, PartyPopper, Zap } from 'lucide-react'
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
  { key: 'doctors_added', label: 'Agrega tus medicos', href: '/dashboard/settings/whatsapp' },
  { key: 'consultation_types_added', label: 'Configura tipos de consulta', href: '/dashboard/settings/whatsapp' },
  { key: 'whatsapp_connected', label: 'Conecta WhatsApp', href: '/dashboard/settings/whatsapp' },
  { key: 'team_invited', label: 'Invita a tu equipo', href: '/dashboard/settings/users', optional: true },
]

export function SetupChecklist({ progress }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  if (progress.completed_at) {
    const completedDate = new Date(progress.completed_at)
    const threeDaysLater = new Date(completedDate.getTime() + 3 * 24 * 60 * 60 * 1000)
    if (new Date() > threeDaysLater) return null
  }

  const completedCount = STEPS.filter((s) => progress[s.key]).length
  const totalSteps = STEPS.length
  const percentage = Math.round((completedCount / totalSteps) * 100)
  const allDone = progress.completed_at !== null

  return (
    <div
      style={{
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        borderRadius: 'var(--v2-radius-lg)',
        boxShadow: 'var(--v2-shadow-sm)',
        overflow: 'hidden',
        fontFamily: 'var(--font-manrope), sans-serif',
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {allDone ? (
            <PartyPopper size={18} style={{ color: 'var(--v2-green)' }} />
          ) : (
            <Zap size={18} style={{ color: 'var(--v2-primary)' }} />
          )}
          <div>
            {allDone ? (
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-green-deep)' }}>
                Tu consultorio esta listo — tu agente WhatsApp esta activo.
              </p>
            ) : (
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>
                Configura tu clínica
                <span style={{ fontWeight: 500, color: 'var(--v2-text-subtle)', marginLeft: '8px' }}>
                  {completedCount} de {totalSteps} pasos
                </span>
              </p>
            )}
          </div>
        </div>
        <ChevronDown
          size={18}
          style={{
            color: 'var(--v2-text-subtle)',
            transition: 'transform 0.2s',
            transform: collapsed ? 'none' : 'rotate(180deg)',
          }}
        />
      </button>

      {/* Progress bar */}
      <div style={{ padding: '0 20px 6px' }}>
        <div style={{ height: '6px', background: 'var(--v2-bg-deeper)', borderRadius: '999px', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              borderRadius: '999px',
              background: allDone
                ? 'var(--v2-green)'
                : 'linear-gradient(90deg, var(--v2-primary), var(--v2-pink))',
              width: `${percentage}%`,
              transition: 'width 0.7s ease-out',
            }}
          />
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div style={{ padding: '10px 20px 18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {STEPS.map((step) => {
            const done = progress[step.key]
            return (
              <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {done ? (
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: 'var(--v2-green-soft)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Check size={12} style={{ color: 'var(--v2-green)' }} />
                  </div>
                ) : (
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: '2px solid var(--v2-border)',
                      flexShrink: 0,
                    }}
                  />
                )}

                {done ? (
                  <span style={{ fontSize: '13.5px', color: 'var(--v2-text-subtle)', textDecoration: 'line-through' }}>
                    {step.label}
                  </span>
                ) : (
                  <Link
                    href={step.href}
                    style={{
                      fontSize: '13.5px',
                      fontWeight: 600,
                      color: 'var(--v2-primary)',
                      textDecoration: 'none',
                    }}
                  >
                    {step.label}
                  </Link>
                )}

                {step.optional && !done && (
                  <span
                    style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--v2-text-subtle)',
                      background: 'var(--v2-bg-soft)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
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
