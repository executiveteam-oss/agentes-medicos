'use client'

// ============================================================
// DashboardActions — Botón "Nueva cita" + modal + cancelar cita
// Se monta en el dashboard principal
// ============================================================

import { useState, useTransition } from 'react'
import { AppointmentFormModal } from '@/components/dashboard/appointment-form-modal'
import { cancelAppointmentWithNotification } from '@/app/actions/appointments'

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
  const [patientReason, setPatientReason] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')

  if (!showConfirm) {
    return (
      <button
        onClick={() => setShowConfirm(true)}
        className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1"
      >
        Cancelar y notificar
      </button>
    )
  }

  return (
    <div className="mt-2 border border-red-200 bg-red-50/30 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-red-800">Cancelar cita</p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo interno (obligatorio)"
        className="input-field text-xs py-1 w-full"
        autoFocus
      />
      <input
        type="text"
        value={patientReason}
        onChange={(e) => setPatientReason(e.target.value)}
        placeholder="Motivo para el paciente (opcional)"
        className="input-field text-xs py-1 w-full"
      />
      <p className="text-[9px] text-slate-400">Se enviará WhatsApp al paciente con disculpa + 3 opciones de reagendamiento</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {warning && <p className="text-xs text-amber-600">{warning}</p>}
      <div className="flex gap-2">
        <button
          disabled={isPending || !reason.trim()}
          onClick={() => {
            startTransition(async () => {
              const result = await cancelAppointmentWithNotification(appointmentId, reason, patientReason || null)
              if (result.ok) {
                if (result.warning) setWarning(result.warning)
                else window.location.reload()
              } else {
                setError(result.error ?? 'Error')
              }
            })
          }}
          className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
        >
          {isPending ? 'Cancelando...' : 'Confirmar y notificar'}
        </button>
        <button
          onClick={() => { setShowConfirm(false); setReason(''); setPatientReason(''); setError(''); setWarning('') }}
          className="text-xs text-slate-500 px-2 py-1.5"
        >
          Volver
        </button>
      </div>
    </div>
  )
}
