'use client'

// ============================================================
// BulkCancelModal — Cancel all appointments for a day
// ============================================================

import { useState, useTransition } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { createBlockedDate } from '@/app/actions/blocked-dates'
import { cancelAppointmentWithNotification } from '@/app/actions/appointments'
import { formatTimeForPatient } from '@/lib/utils/dates'
import type { CalendarAppointment } from './types'

interface Props {
  date: string // YYYY-MM-DD
  dateFormatted: string
  appointments: CalendarAppointment[]
  doctorId: string | null // null = all doctors
  doctorName: string | null
  onClose: () => void
  onDone: (cancelled: number, notified: number) => void
}

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export function BulkCancelModal({ date, dateFormatted, appointments, doctorId, doctorName, onClose, onDone }: Props) {
  const cancellable = appointments.filter((a) => a.status === 'confirmed' || a.status === 'rescheduled')
  const [internalReason, setInternalReason] = useState('')
  const [patientReason, setPatientReason] = useState('')
  const [createBlock, setCreateBlock] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [confirmed, setConfirmed] = useState(false)

  function handleSubmit() {
    if (!confirmed) {
      setConfirmed(true)
      return
    }

    startTransition(async () => {
      let cancelled = 0
      let notified = 0

      if (createBlock) {
        // Use createBlockedDate with cancelAndNotify — handles everything
        const result = await createBlockedDate({
          doctorId: doctorId ?? undefined,
          startDate: date,
          endDate: date,
          reason: internalReason.trim() || 'Cancelacion masiva',
          patientReason: patientReason.trim() || null,
          cancelAndNotify: true,
        })
        if (result.ok) {
          cancelled = result.cancelled ?? 0
          notified = result.notified ?? 0
        }
      } else {
        // Cancel each individually without creating block
        for (const apt of cancellable) {
          const result = await cancelAppointmentWithNotification(
            apt.id,
            internalReason.trim() || 'Cancelacion masiva',
            patientReason.trim() || null,
          )
          if (result.ok) {
            cancelled++
            if (result.whatsappSent) notified++
          }
        }
      }

      onDone(cancelled, notified)
    })
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(26, 21, 48, 0.5)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isPending) onClose() }}
    >
      <div
        style={{
          background: 'var(--v2-bg-card)',
          borderRadius: 'var(--v2-radius-xl)',
          boxShadow: 'var(--v2-shadow-lg)',
          maxWidth: '560px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
          fontFamily: 'var(--font-manrope), sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--v2-text)' }}>
              Cancelar {cancellable.length} cita{cancellable.length !== 1 ? 's' : ''} del {dateFormatted}
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>
              {doctorName ? `Doctor ${doctorName}` : 'Todos los doctores'}
            </p>
          </div>
          <button onClick={onClose} disabled={isPending} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        {/* Appointments preview */}
        <div
          style={{
            padding: '14px',
            borderRadius: 'var(--v2-radius)',
            background: 'var(--v2-amber-soft)',
            border: '1px solid rgba(255, 184, 69, 0.3)',
            marginBottom: '16px',
            maxHeight: '240px',
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
            <AlertTriangle size={14} style={{ color: '#b07d00' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#b07d00' }}>Citas que seran canceladas</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {cancellable.map((apt) => (
              <div key={apt.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontWeight: 700, color: 'var(--v2-text)', width: '60px', flexShrink: 0 }}>
                  {formatTimeForPatient(apt.starts_at)}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--v2-text)' }}>{apt.patient?.name ?? 'Paciente'}</span>
                {apt.reason && <span style={{ color: 'var(--v2-text-subtle)' }}>· {apt.reason}</span>}
                {apt.doctor && !doctorId && <span style={{ color: 'var(--v2-text-subtle)' }}>· {apt.doctor.name}</span>}
              </div>
            ))}
          </div>
          <p style={{ fontSize: '10px', color: '#b07d00', marginTop: '8px' }}>
            Cada paciente recibira WhatsApp con disculpa y 3 opciones de reagendamiento.
          </p>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>
              Motivo interno *
            </label>
            <input
              className="input-v2"
              value={internalReason}
              onChange={(e) => setInternalReason(e.target.value)}
              placeholder="Doctor enfermo, emergencia personal..."
              disabled={isPending}
            />
            <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>Solo visible internamente</p>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)', marginBottom: '4px' }}>
              Motivo para el paciente (opcional)
            </label>
            <input
              className="input-v2"
              value={patientReason}
              onChange={(e) => setPatientReason(e.target.value)}
              placeholder="porque el doctor esta indispuesto por motivos de salud"
              disabled={isPending}
            />
            <p style={{ fontSize: '10px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>Se incluye en el WhatsApp. Sin texto = motivo generico empatico.</p>
          </div>
        </div>

        {/* Block toggle */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            padding: '12px 14px', borderRadius: 'var(--v2-radius)',
            border: '1px solid var(--v2-border-soft)', marginBottom: '16px',
          }}
        >
          <div>
            <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>Bloquear agenda del dia</p>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)' }}>El agente no ofrecera nuevos slots ese dia</p>
          </div>
          <button
            onClick={() => setCreateBlock(!createBlock)}
            disabled={isPending}
            className="toggle-v2"
            data-active={createBlock ? 'true' : 'false'}
          />
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} disabled={isPending} className="btn-v2-secondary" style={{ flex: 1, fontSize: '13px' }}>
            Volver
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !internalReason.trim()}
            style={{
              flex: 1, fontSize: '13px', fontWeight: 700, padding: '10px 18px',
              borderRadius: 'var(--v2-radius)', border: 'none', cursor: 'pointer',
              background: confirmed ? 'var(--v2-red)' : 'linear-gradient(135deg, var(--v2-red), #FF7B7B)',
              color: '#fff', opacity: isPending || !internalReason.trim() ? 0.5 : 1,
              fontFamily: 'var(--font-manrope), sans-serif',
            }}
          >
            {isPending ? 'Cancelando...' : confirmed ? `Confirmar: cancelar ${cancellable.length} citas` : `Cancelar ${cancellable.length} citas`}
          </button>
        </div>
      </div>
    </div>
  )
}
