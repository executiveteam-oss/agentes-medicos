'use client'

// ============================================================
// CarteraFormModal — Modal para crear/editar entradas de cartera
// Usado en: /dashboard/cartera
// ============================================================

import { useState, useTransition, useEffect, useCallback } from 'react'
import { PatientSearch } from '@/components/dashboard/patient-search'
import { createCarteraEntry, updateCarteraEntry } from '@/app/actions/cartera'
import type { CarteraInput } from '@/app/actions/cartera'
import type { PaymentType } from '@/types/database'

interface CarteraFormData {
  id?: string
  patient_id: string
  patient_name?: string
  treatment: string
  amount: number
  payment_type: PaymentType
  due_date: string
  notes: string
}

interface CarteraFormModalProps {
  isOpen: boolean
  onClose: () => void
  initialData?: CarteraFormData
  onSaved: () => void
}

const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
  { value: 'EPS', label: 'EPS' },
  { value: 'Particular', label: 'Particular' },
  { value: 'Póliza', label: 'Póliza' },
  { value: 'ARL', label: 'ARL' },
  { value: 'SOAT', label: 'SOAT' },
]

/** Formatea un número como COP: 150000 → "$150.000" */
function formatCOPPreview(value: number): string {
  if (!value || isNaN(value)) return ''
  return '$' + value.toLocaleString('es-CO') + ' COP'
}

export function CarteraFormModal({ isOpen, onClose, initialData, onSaved }: CarteraFormModalProps) {
  const isEditing = !!initialData?.id
  const [isPending, startTransition] = useTransition()

  const [patientId, setPatientId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [treatment, setTreatment] = useState('')
  const [amountStr, setAmountStr] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType>('Particular')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Inicializar formulario cuando cambia initialData o se abre el modal
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setPatientId(initialData.patient_id)
        setPatientName(initialData.patient_name ?? '')
        setTreatment(initialData.treatment)
        setAmountStr(initialData.amount ? String(initialData.amount) : '')
        setPaymentType(initialData.payment_type)
        setDueDate(initialData.due_date)
        setNotes(initialData.notes)
      } else {
        // Reset para nuevo registro
        setPatientId('')
        setPatientName('')
        setTreatment('')
        setAmountStr('')
        setPaymentType('Particular')
        setDueDate('')
        setNotes('')
      }
      setError('')
      setSuccess('')
    }
  }, [isOpen, initialData])

  // Cerrar con Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const amount = parseInt(amountStr, 10) || 0

  function handleAmountChange(val: string) {
    // Solo permitir dígitos
    const cleaned = val.replace(/\D/g, '')
    setAmountStr(cleaned)
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    // Validaciones del lado del cliente
    if (!patientId) {
      setError('Selecciona un paciente')
      return
    }
    if (!treatment.trim()) {
      setError('El concepto es obligatorio')
      return
    }
    if (!amount || amount <= 0) {
      setError('El monto debe ser mayor a 0')
      return
    }
    if (!dueDate) {
      setError('La fecha de vencimiento es obligatoria')
      return
    }

    const input: CarteraInput = {
      patient_id: patientId,
      treatment: treatment.trim(),
      amount,
      payment_type: paymentType,
      due_date: dueDate,
      notes: notes.trim(),
    }

    startTransition(async () => {
      const result = isEditing
        ? await updateCarteraEntry(initialData!.id!, input)
        : await createCarteraEntry(input)

      if (result.ok) {
        setSuccess(isEditing ? 'Entrada actualizada' : 'Entrada creada')
        // Pequeño delay para que el usuario vea el mensaje
        setTimeout(() => {
          onSaved()
          onClose()
        }, 400)
      } else {
        setError(result.error ?? 'Error guardando entrada')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div className="card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto p-6">
        {/* Encabezado */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEditing ? 'Editar entrada de cartera' : 'Nueva entrada de cartera'}
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
            <label className="label">Paciente *</label>
            <PatientSearch
              value={patientId}
              onChange={(id, name) => {
                setPatientId(id)
                setPatientName(name)
              }}
              placeholder="Buscar paciente..."
            />
          </div>

          {/* Concepto / Tratamiento */}
          <div>
            <label className="label">Concepto / Tratamiento *</label>
            <input
              type="text"
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
              placeholder="Ej: Consulta 12 marzo"
              className="input-field w-full"
              maxLength={200}
            />
          </div>

          {/* Monto */}
          <div>
            <label className="label">Monto (COP) *</label>
            <input
              type="text"
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="Ej: 150000"
              className="input-field w-full"
            />
            {amount > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                {formatCOPPreview(amount)}
              </p>
            )}
          </div>

          {/* Tipo de pago */}
          <div>
            <label className="label">Tipo de pago</label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as PaymentType)}
              className="input-field w-full"
            >
              {PAYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Fecha de vencimiento */}
          <div>
            <label className="label">Fecha de vencimiento *</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input-field w-full"
            />
          </div>

          {/* Notas */}
          <div>
            <label className="label">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas adicionales (opcional)"
              className="input-field w-full resize-none"
              rows={3}
              maxLength={500}
            />
          </div>

          {/* Mensajes de error / éxito */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">
              {success}
            </p>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={isPending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isPending}
            >
              {isPending
                ? 'Guardando...'
                : isEditing
                  ? 'Guardar cambios'
                  : 'Crear entrada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
