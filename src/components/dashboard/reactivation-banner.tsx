'use client'

// ============================================================
// ReactivationBanner — Banner de reactivación en detalle de paciente
// Muestra frecuencia de visita, días sin visita, y botón de recordatorio
// ============================================================

import { useState, useTransition } from 'react'
import { sendManualReactivation } from '@/app/actions/reactivation'

interface Props {
  patientId: string
  visitFrequencyDays: number | null
  daysSinceLastVisit: number | null
  frequencyLabel: string | null  // "cada 2 semanas", etc.
}

export function ReactivationBanner({
  patientId,
  visitFrequencyDays,
  daysSinceLastVisit,
  frequencyLabel,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOverdue = visitFrequencyDays && daysSinceLastVisit
    ? daysSinceLastVisit > visitFrequencyDays * 1.5
    : daysSinceLastVisit !== null && daysSinceLastVisit > 90

  function handleSend() {
    setError(null)
    startTransition(async () => {
      const result = await sendManualReactivation(patientId)
      if (result.ok) {
        setSent(true)
      } else {
        setError(result.error ?? 'Error enviando mensaje')
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Info de frecuencia */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Frecuencia de visita</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-0.5">Frecuencia habitual</p>
            <p className="text-sm font-medium text-slate-700">
              {frequencyLabel ?? 'Sin datos suficientes'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-0.5">Última visita</p>
            <p className={`text-sm font-medium ${isOverdue ? 'text-amber-600' : 'text-slate-700'}`}>
              {daysSinceLastVisit !== null
                ? `Hace ${daysSinceLastVisit} días`
                : 'Sin visitas'}
            </p>
          </div>
          {visitFrequencyDays && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-0.5">Próxima visita esperada</p>
              <p className={`text-sm font-medium ${isOverdue ? 'text-red-600' : 'text-slate-700'}`}>
                {daysSinceLastVisit !== null
                  ? daysSinceLastVisit > visitFrequencyDays
                    ? `Vencida hace ${daysSinceLastVisit - visitFrequencyDays} días`
                    : `En ${visitFrequencyDays - daysSinceLastVisit} días`
                  : '-'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Overdue banner */}
      {isOverdue && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-800">
              Este paciente no ha vuelto en más tiempo del habitual
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {visitFrequencyDays
                ? `Frecuencia habitual: cada ${visitFrequencyDays} días · Última visita: hace ${daysSinceLastVisit} días`
                : `Última visita: hace ${daysSinceLastVisit} días`}
            </p>
          </div>
          {sent ? (
            <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap shrink-0">
              Recordatorio enviado
            </span>
          ) : (
            <button
              onClick={handleSend}
              disabled={isPending}
              className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {isPending ? 'Enviando...' : 'Enviar recordatorio ahora'}
            </button>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
