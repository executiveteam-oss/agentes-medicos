'use client'

// ============================================================
// RegisterGlosaInline — Formulario inline para registrar glosa
// Se muestra cuando cambian estado de cobro a "glosada"
// ============================================================

import { useState, useTransition } from 'react'
import { registrarGlosa } from '@/app/actions/glosas'
import { GLOSA_REASONS } from '@/lib/utils/glosa-reasons'

interface Props {
  appointmentId: string
  defaultAmount: number
  onRegistered: () => void
  onCancel: () => void
}

function todayStr(): string {
  const d = new Date()
  const col = new Date(d.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  return `${col.getFullYear()}-${String(col.getMonth() + 1).padStart(2, '0')}-${String(col.getDate()).padStart(2, '0')}`
}

export function RegisterGlosaInline({ appointmentId, defaultAmount, onRegistered, onCancel }: Props) {
  const [reason, setReason] = useState<string>(GLOSA_REASONS[0])
  const [customReason, setCustomReason] = useState('')
  const [amount, setAmount] = useState(defaultAmount)
  const [notifDate, setNotifDate] = useState(todayStr())
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleSubmit() {
    if (amount <= 0) { setError('El valor debe ser mayor a 0'); return }
    setError('')
    startTransition(async () => {
      const result = await registrarGlosa({
        appointmentId,
        reason,
        customReason: reason === 'Otro' ? customReason : undefined,
        amount,
        notificationDate: notifDate,
      })
      if (result.ok) {
        onRegistered()
      } else {
        setError(result.error ?? 'Error')
      }
    })
  }

  return (
    <div className="px-5 py-4 bg-amber-50/50 border-t border-amber-200">
      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-3">Registrar glosa</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Motivo</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input-field text-sm w-full"
          >
            {GLOSA_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {reason === 'Otro' && (
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Especifique"
              className="input-field text-sm w-full mt-1"
            />
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Valor glosado</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
            className="input-field text-sm w-full"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Fecha notificación</label>
          <input
            type="date"
            value={notifDate}
            onChange={(e) => setNotifDate(e.target.value)}
            className="input-field text-sm w-full"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Plazo</label>
          <p className="text-sm text-amber-700 font-medium mt-1.5">15 días hábiles</p>
        </div>
      </div>
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {isPending ? 'Registrando...' : 'Registrar glosa'}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
          Cancelar
        </button>
      </div>
    </div>
  )
}
