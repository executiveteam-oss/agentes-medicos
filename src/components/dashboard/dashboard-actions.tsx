'use client'

// ============================================================
// DashboardActions — Botón "Nueva cita" + modal + cancelar cita
// Se monta en el dashboard principal
// ============================================================

import { useState, useTransition } from 'react'
import { AppointmentFormModal } from '@/components/dashboard/appointment-form-modal'
import { cancelAppointment } from '@/app/actions/appointments'

interface Doctor {
  id: string
  name: string
  specialty: string | null
}

interface Props {
  doctors: Doctor[]
  minBookingAdvanceHours?: number
}

export function NewAppointmentButton({ doctors, minBookingAdvanceHours }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  return (
    <>
      <button onClick={() => setShowModal(true)} className="btn-primary text-sm">
        + Nueva cita
      </button>

      <AppointmentFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        doctors={doctors}
        minBookingAdvanceHours={minBookingAdvanceHours}
        onSaved={() => {
          setToast('Cita creada')
          setTimeout(() => setToast(null), 3000)
          // revalidatePath se ejecuta en el server action
          window.location.reload()
        }}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}
    </>
  )
}

export function CancelAppointmentButton({ appointmentId }: { appointmentId: string }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  if (!showConfirm) {
    return (
      <button
        onClick={() => setShowConfirm(true)}
        className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1"
      >
        Cancelar cita
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo de cancelación..."
        className="input-field text-xs py-1 flex-1"
        autoFocus
      />
      <button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await cancelAppointment(appointmentId, reason)
            if (result.ok) {
              window.location.reload()
            } else {
              setError(result.error ?? 'Error')
            }
          })
        }}
        className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded-lg font-medium disabled:opacity-50"
      >
        {isPending ? '...' : 'Confirmar'}
      </button>
      <button
        onClick={() => { setShowConfirm(false); setReason('') }}
        className="text-xs text-slate-400 hover:text-slate-600 px-1"
      >
        &times;
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
