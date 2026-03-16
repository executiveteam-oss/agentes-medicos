'use client'

// ============================================================
// CarteraRow — Fila de cartera con botón de cobro por WhatsApp
// ============================================================

import { useTransition, useState } from 'react'
import { sendCollectionMessage } from '@/app/actions/cartera'
import { formatCOP } from '@/lib/utils/dates'
import type { CarteraEntryWithDetails } from '@/types/database'

interface CarteraRowProps {
  entry: CarteraEntryWithDetails
}

const PAYMENT_COLORS: Record<string, string> = {
  EPS: 'bg-blue-50 text-blue-700',
  Particular: 'bg-emerald-50 text-emerald-700',
  Póliza: 'bg-purple-50 text-purple-700',
  ARL: 'bg-amber-50 text-amber-700',
  SOAT: 'bg-yellow-50 text-yellow-700',
}

export function CarteraRow({ entry }: CarteraRowProps) {
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCobrar = () => {
    setError(null)
    startTransition(async () => {
      const result = await sendCollectionMessage(entry.id)
      if (result.ok) {
        setSent(true)
      } else {
        setError(result.error ?? 'Error enviando mensaje')
      }
    })
  }

  const isOverdue30 = entry.days_overdue > 30

  return (
    <tr className={`border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors ${isOverdue30 ? 'bg-red-50/30' : ''}`}>
      <td className="py-3.5 px-5 text-sm font-medium text-slate-900">{entry.patient?.name ?? '-'}</td>
      <td className="py-3.5 px-5 text-slate-500 text-sm">
        {entry.patient?.phone?.replace('+57', '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') ?? '-'}
      </td>
      <td className="py-3.5 px-5 text-right">
        <span className="text-sm font-semibold text-slate-900">{formatCOP(entry.amount)}</span>
      </td>
      <td className="py-3.5 px-5">
        <span className={`badge ${isOverdue30 ? 'badge-red' : 'badge-amber'}`}>
          {entry.days_overdue}d
        </span>
      </td>
      <td className="py-3.5 px-5">
        <span className={`badge ${PAYMENT_COLORS[entry.payment_type] ?? 'badge-slate'}`}>
          {entry.payment_type}
        </span>
      </td>
      <td className="py-3.5 px-5 text-slate-500 text-sm">{entry.treatment ?? '-'}</td>
      <td className="py-3.5 px-5 text-center text-slate-500 text-sm">{entry.collection_attempts}</td>
      <td className="py-3.5 px-5 text-right">
        {error && <p className="text-red-600 text-xs mb-1">{error}</p>}
        {sent ? (
          <span className="badge badge-green">Enviado</span>
        ) : (
          <button
            disabled={isPending}
            onClick={handleCobrar}
            className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors whitespace-nowrap"
          >
            {isPending ? '...' : 'Cobrar WA'}
          </button>
        )}
      </td>
    </tr>
  )
}
