'use client'

// ============================================================
// Formulario admin para actualizar estado de componentes
// ============================================================

import { useState, useTransition } from 'react'
import { updateSystemStatus } from '@/app/actions/system-status'
import type { SystemComponent } from '@/app/actions/system-status'

const COMPONENT_LABELS: Record<string, string> = {
  whatsapp_agent: 'Agente WhatsApp',
  web_dashboard: 'Dashboard web',
  reminders: 'Recordatorios automáticos',
  appointments: 'Procesamiento de citas',
  database: 'Base de datos',
}

function getComponentLabel(component: string): string {
  return COMPONENT_LABELS[component] ?? component
}

interface Props {
  components: SystemComponent[]
}

const STATUS_OPTIONS: Array<{ value: SystemComponent['status']; label: string; icon: string }> = [
  { value: 'operational', label: 'Operativo', icon: '🟢' },
  { value: 'degraded', label: 'Degradado', icon: '🟡' },
  { value: 'outage', label: 'Interrupción', icon: '🔴' },
]

export function SystemStatusAdmin({ components: initial }: Props) {
  const [components, setComponents] = useState(initial)
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)

  function handleUpdate(comp: SystemComponent, newStatus: SystemComponent['status'], message?: string) {
    setFeedback(null)
    startTransition(async () => {
      const result = await updateSystemStatus(comp.id, newStatus, message)
      if (result.ok) {
        setComponents(prev =>
          prev.map(c => c.id === comp.id
            ? { ...c, status: newStatus, message: message?.trim() || null, updated_at: new Date().toISOString() }
            : c
          )
        )
        setFeedback('Estado actualizado')
        setTimeout(() => setFeedback(null), 3000)
      } else {
        setFeedback(result.error ?? 'Error')
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Estado del sistema</h3>
        <p className="text-xs text-slate-400 mb-5">
          Actualiza el estado de cada componente. Visible públicamente en /status.
        </p>

        <div className="space-y-4">
          {components.map((comp) => (
            <ComponentRow
              key={comp.id}
              component={comp}
              onUpdate={handleUpdate}
              disabled={isPending}
            />
          ))}
        </div>

        {feedback && (
          <p className="mt-4 text-sm text-emerald-600 font-medium">{feedback}</p>
        )}
      </div>
    </div>
  )
}

function ComponentRow({
  component,
  onUpdate,
  disabled,
}: {
  component: SystemComponent
  onUpdate: (comp: SystemComponent, status: SystemComponent['status'], message?: string) => void
  disabled: boolean
}) {
  const [status, setStatus] = useState(component.status)
  const [message, setMessage] = useState(component.message ?? '')

  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-slate-900">
          {getComponentLabel(component.component)}
        </p>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as SystemComponent['status'])}
          className="input-field w-40 text-sm"
          disabled={disabled}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.icon} {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Mensaje opcional (ej: Mantenimiento programado)"
          className="input-field flex-1 text-sm"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => onUpdate(component, status, message)}
          disabled={disabled || (status === component.status && message === (component.message ?? ''))}
          className="btn-primary text-sm px-4"
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}
