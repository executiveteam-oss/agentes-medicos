'use client'

// ============================================================
// PatientFormModal — Modal para crear/editar pacientes
// ============================================================

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { createPatient, updatePatient } from '@/app/actions/patients'
import type { PatientInput } from '@/app/actions/patients'
import type { DocumentType } from '@/types/database'

import { EPS_OPTIONS } from '@/lib/utils/eps-options'
import { getAllEapbCodes } from '@/lib/utils/eapb-codes'

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'CC', label: 'Cédula de Ciudadanía' },
  { value: 'TI', label: 'Tarjeta de Identidad' },
  { value: 'CE', label: 'Cédula de Extranjería' },
  { value: 'PP', label: 'Pasaporte' },
]

interface PatientFormData {
  id?: string
  name: string
  phone: string
  document_type: DocumentType
  document_number: string
  date_of_birth: string
  eps: string
  email: string
  notes: string
  // Campos Resolución 256
  first_name?: string | null
  middle_name?: string | null
  first_last_name?: string | null
  second_last_name?: string | null
  gender?: 'M' | 'F' | null
  eapb_code?: string | null
}

interface PatientFormModalProps {
  isOpen: boolean
  onClose: () => void
  initialData?: PatientFormData
  onSaved: () => void
}

const EMPTY_FORM: PatientFormData = {
  name: '',
  phone: '',
  document_type: 'CC',
  document_number: '',
  date_of_birth: '',
  eps: '',
  email: '',
  notes: '',
  first_name: null,
  middle_name: null,
  first_last_name: null,
  second_last_name: null,
  gender: null,
  eapb_code: null,
}

export function PatientFormModal({ isOpen, onClose, initialData, onSaved }: PatientFormModalProps) {
  const [form, setForm] = useState<PatientFormData>(initialData ?? EMPTY_FORM)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const isEditing = !!initialData?.id

  // Resetear formulario cuando se abre/cierra o cambia initialData
  useEffect(() => {
    if (isOpen) {
      setForm(initialData ?? EMPTY_FORM)
      setError(null)
      setSuccess(null)
    }
  }, [isOpen, initialData])

  // Cerrar con Esc
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isPending) {
        onClose()
      }
    },
    [isOpen, isPending, onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Click fuera del modal para cerrar
  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current && !isPending) {
      onClose()
    }
  }

  function updateField<K extends keyof PatientFormData>(key: K, value: PatientFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError(null)
    setSuccess(null)
  }

  // Formatear teléfono: solo dígitos, máximo 10
  function handlePhoneChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 10)
    updateField('phone', digits)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    // Validaciones básicas del lado del cliente
    if (!form.name.trim()) {
      setError('El nombre es obligatorio')
      return
    }
    if (!form.phone.trim() || form.phone.length < 10) {
      setError('El teléfono debe tener 10 dígitos')
      return
    }

    const input: PatientInput = {
      name: form.name,
      phone: form.phone,
      document_type: form.document_type,
      document_number: form.document_number,
      date_of_birth: form.date_of_birth,
      eps: form.eps,
      email: form.email,
      notes: form.notes,
      // Campos Resolución 256
      first_name: form.first_name || null,
      middle_name: form.middle_name || null,
      first_last_name: form.first_last_name || null,
      second_last_name: form.second_last_name || null,
      gender: form.gender ?? null,
      eapb_code: form.eapb_code ?? null,
    }

    startTransition(async () => {
      const result = isEditing
        ? await updatePatient(initialData!.id!, input)
        : await createPatient(input)

      if (!result.ok) {
        setError(result.error ?? 'Error inesperado')
        return
      }

      setSuccess(isEditing ? 'Paciente actualizado' : 'Paciente creado')
      // Pequeña pausa para que el usuario vea el mensaje
      setTimeout(() => {
        onSaved()
        onClose()
      }, 600)
    })
  }

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <div className="card-v2 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEditing ? 'Editar paciente' : 'Nuevo paciente'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none"
            aria-label="Cerrar"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Nombre */}
          <div>
            <label htmlFor="pf-name" className="label">Nombre *</label>
            <input
              id="pf-name"
              type="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Nombre completo del paciente"
              className="input-v2"
              autoFocus
            />
          </div>

          {/* Teléfono */}
          <div>
            <label htmlFor="pf-phone" className="label">Teléfono *</label>
            <div className="flex">
              <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 text-slate-500 text-sm">
                +57
              </span>
              <input
                id="pf-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="3XX XXX XXXX"
                className="input-v2 rounded-l-none"
                maxLength={10}
              />
            </div>
          </div>

          {/* Documento: tipo + número en fila */}
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-2">
              <label htmlFor="pf-doc-type" className="label">Tipo doc.</label>
              <select
                id="pf-doc-type"
                value={form.document_type}
                onChange={(e) => updateField('document_type', e.target.value as DocumentType)}
                className="input-v2"
              >
                {DOCUMENT_TYPES.map((dt) => (
                  <option key={dt.value} value={dt.value}>{dt.value}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label htmlFor="pf-doc-number" className="label">Número de documento</label>
              <input
                id="pf-doc-number"
                type="text"
                value={form.document_number}
                onChange={(e) => updateField('document_number', e.target.value)}
                placeholder="1.234.567.890"
                className="input-v2"
              />
            </div>
          </div>

          {/* Fecha de nacimiento */}
          <div>
            <label htmlFor="pf-dob" className="label">Fecha de nacimiento</label>
            <input
              id="pf-dob"
              type="date"
              value={form.date_of_birth}
              onChange={(e) => updateField('date_of_birth', e.target.value)}
              className="input-v2"
              max={new Date().toISOString().split('T')[0]}
            />
          </div>

          {/* EPS */}
          <div>
            <label htmlFor="pf-eps" className="label">EPS</label>
            <select
              id="pf-eps"
              value={form.eps}
              onChange={(e) => updateField('eps', e.target.value)}
              className="input-v2"
            >
              <option value="">Seleccionar EPS...</option>
              {EPS_OPTIONS.map((eps) => (
                <option key={eps} value={eps}>{eps}</option>
              ))}
            </select>
          </div>

          {/* Email */}
          <div>
            <label htmlFor="pf-email" className="label">Correo electrónico</label>
            <input
              id="pf-email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="paciente@correo.com"
              className="input-v2"
            />
          </div>

          {/* Notas */}
          <div>
            <label htmlFor="pf-notes" className="label">Notas</label>
            <textarea
              id="pf-notes"
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Notas internas sobre el paciente..."
              className="input-v2 resize-none"
              rows={3}
            />
          </div>

          {/* Mensaje de error o éxito */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>
          )}
          {success && (
            <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-4 py-2">{success}</p>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="btn-v2-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-v2-primary"
            >
              {isPending ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear paciente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
