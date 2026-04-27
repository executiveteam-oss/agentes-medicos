'use client'

// ============================================================
// WaitlistFormModal — Modal para agregar paciente a lista de espera
// ============================================================

import { useState, useTransition, useEffect, useCallback } from 'react'
import { createWaitlistEntry } from '@/app/actions/waitlist'
import { PatientSearch } from '@/components/dashboard/patient-search'
import type { WaitlistInput } from '@/app/actions/waitlist'

interface Doctor {
  id: string
  name: string
  specialty: string | null
}

interface WaitlistFormModalProps {
  isOpen: boolean
  onClose: () => void
  doctors: Doctor[]
  onSaved: () => void
}

export function WaitlistFormModal({ isOpen, onClose, doctors, onSaved }: WaitlistFormModalProps) {
  const [patientId, setPatientId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [reason, setReason] = useState('')
  const [priority, setPriority] = useState<WaitlistInput['priority']>('normal')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isPending, startTransition] = useTransition()

  // Resetear formulario al abrir/cerrar
  useEffect(() => {
    if (isOpen) {
      setPatientId('')
      setPatientName('')
      setDoctorId(doctors.length === 1 ? doctors[0].id : '')
      setReason('')
      setPriority('normal')
      setError('')
      setSuccess('')
    }
  }, [isOpen, doctors])

  // Cerrar con Esc
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      return () => document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen, onClose])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      setError('')
      setSuccess('')

      if (!patientId) {
        setError('Selecciona un paciente')
        return
      }
      if (!doctorId) {
        setError('Selecciona un doctor')
        return
      }

      startTransition(async () => {
        const result = await createWaitlistEntry({
          patient_id: patientId,
          doctor_id: doctorId,
          reason: reason.trim(),
          priority,
        })

        if (!result.ok) {
          setError(result.error ?? 'Error al agregar a lista de espera')
          return
        }

        setSuccess('Paciente agregado a la lista de espera')
        setTimeout(() => {
          onSaved()
          onClose()
        }, 600)
      })
    },
    [patientId, doctorId, reason, priority, onSaved, onClose]
  )

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card-v2 w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        {/* Encabezado */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Agregar a lista de espera
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Paciente */}
          <div>
            <label className="label">Paciente</label>
            <PatientSearch
              value={patientId}
              onChange={(id, name) => {
                setPatientId(id)
                setPatientName(name)
              }}
              placeholder="Buscar paciente por nombre o telefono..."
            />
          </div>

          {/* Doctor */}
          <div>
            <label className="label">Doctor</label>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="input-v2 w-full"
            >
              <option value="">Seleccionar doctor...</option>
              {doctors.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name}
                  {doc.specialty ? ` — ${doc.specialty}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Motivo */}
          <div>
            <label className="label">Motivo de consulta</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: Control de rutina, dolor de cabeza..."
              className="input-v2 w-full"
            />
          </div>

          {/* Prioridad */}
          <div>
            <label className="label">Prioridad</label>
            <div className="flex gap-4 mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="priority"
                  value="normal"
                  checked={priority === 'normal'}
                  onChange={() => setPriority('normal')}
                  className="accent-blue-600"
                />
                <span className="text-sm text-slate-700">Normal</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="priority"
                  value="urgente"
                  checked={priority === 'urgente'}
                  onChange={() => setPriority('urgente')}
                  className="accent-red-600"
                />
                <span className="text-sm text-slate-700">Urgente</span>
              </label>
            </div>
          </div>

          {/* Mensajes de error/exito */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">
              {success}
            </p>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-v2-secondary"
              disabled={isPending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-v2-primary"
              disabled={isPending}
            >
              {isPending ? 'Guardando...' : 'Agregar a espera'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
