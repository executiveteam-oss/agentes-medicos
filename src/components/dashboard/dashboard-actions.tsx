'use client'

// ============================================================
// DashboardActions — Boton "Nueva cita" v2 + cancelar cita
// ============================================================

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
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
      <button
        onClick={() => setShowModal(true)}
        className="btn-v2-primary"
        style={{ fontSize: '13px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        <Plus size={16} />
        Nueva cita
      </button>

      <AppointmentFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        doctors={doctors}
        minBookingAdvanceHours={minBookingAdvanceHours}
        onSaved={() => {
          setToast('Cita creada')
          setTimeout(() => setToast(null), 3000)
          window.location.reload()
        }}
      />

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 50,
            padding: '12px 20px',
            borderRadius: 'var(--v2-radius)',
            fontSize: '13px',
            fontWeight: 600,
            color: '#fff',
            background: 'var(--v2-text)',
            boxShadow: 'var(--v2-shadow-lg)',
            fontFamily: 'var(--font-manrope), sans-serif',
          }}
        >
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
        style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-red)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
      >
        Cancelar y notificar
      </button>
    )
  }

  return (
    <div
      style={{
        marginTop: '8px',
        border: '1px solid rgba(255,87,87,0.3)',
        background: 'var(--v2-red-soft)',
        borderRadius: 'var(--v2-radius)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        fontFamily: 'var(--font-manrope), sans-serif',
      }}
    >
      <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--v2-red)' }}>Cancelar cita</p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo interno (obligatorio)"
        className="input-v2"
        style={{ fontSize: '12px', padding: '8px 10px' }}
        autoFocus
      />
      <input
        type="text"
        value={patientReason}
        onChange={(e) => setPatientReason(e.target.value)}
        placeholder="Motivo para el paciente (opcional)"
        className="input-v2"
        style={{ fontSize: '12px', padding: '8px 10px' }}
      />
      <p style={{ fontSize: '9px', color: 'var(--v2-text-subtle)' }}>Se enviara WhatsApp al paciente con disculpa + 3 opciones de reagendamiento</p>
      {error && <p style={{ fontSize: '12px', color: 'var(--v2-red)' }}>{error}</p>}
      {warning && <p style={{ fontSize: '12px', color: '#b07d00' }}>{warning}</p>}
      <div style={{ display: 'flex', gap: '8px' }}>
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
          className="btn-v2-primary"
          style={{ fontSize: '12px', padding: '6px 14px', background: 'var(--v2-red)', opacity: isPending || !reason.trim() ? 0.5 : 1 }}
        >
          {isPending ? 'Cancelando...' : 'Confirmar y notificar'}
        </button>
        <button
          onClick={() => { setShowConfirm(false); setReason(''); setPatientReason(''); setError(''); setWarning('') }}
          className="btn-v2-ghost"
          style={{ fontSize: '12px', padding: '6px 14px' }}
        >
          Volver
        </button>
      </div>
    </div>
  )
}
