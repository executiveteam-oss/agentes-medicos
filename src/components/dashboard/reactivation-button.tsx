'use client'

// ============================================================
// Botón de reactivación manual — Usado en analytics y otros
// ============================================================

import { useState, useTransition } from 'react'
import { sendManualReactivation } from '@/app/actions/reactivation'

interface Props {
  patientId: string
  patientName: string
}

export function ReactivationButton({ patientId, patientName }: Props) {
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  if (sent) {
    return <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">Enviado</span>
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleSend}
        disabled={isPending}
        className="btn-primary text-xs py-1 px-2.5 whitespace-nowrap disabled:opacity-50"
        title={`Enviar recordatorio a ${patientName}`}
      >
        {isPending ? 'Enviando...' : 'Recordatorio'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
