'use client'

// ============================================================
// AppointmentFormModal — Modal para crear/editar citas desde dashboard
// Usa PatientSearch para seleccionar paciente, con soporte de
// tipo de pago (EPS, Particular, etc.) y validación inline.
// ============================================================

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { PatientSearch } from '@/components/dashboard/patient-search'
import {
  createAppointment,
  updateAppointmentFromDashboard,
} from '@/app/actions/appointments'
import type { AppointmentInput } from '@/app/actions/appointments'
import type { PaymentType, AppointmentModality } from '@/types/database'

interface DoctorOption {
  id: string
  name: string
  specialty: string | null
}

interface InitialData {
  id: string
  patient_id: string
  patient_name: string
  doctor_id: string
  date: string        // YYYY-MM-DD
  time: string        // HH:mm
  duration_minutes: number
  reason: string
  payment_type: PaymentType
  eps_name: string
}

interface AppointmentFormModalProps {
  isOpen: boolean
  onClose: () => void
  doctors: DoctorOption[]
  initialData?: InitialData
  minBookingAdvanceHours?: number
  onSaved: () => void
}

const PAYMENT_TYPES: PaymentType[] = ['Particular', 'EPS', 'Póliza', 'ARL', 'SOAT']

const EPS_OPTIONS = [
  'Sura',
  'Compensar',
  'Nueva EPS',
  'Sanitas',
  'Coosalud',
  'Medimás',
  'Otra',
]

export function AppointmentFormModal({
  isOpen,
  onClose,
  doctors,
  initialData,
  minBookingAdvanceHours,
  onSaved,
}: AppointmentFormModalProps) {
  const isEditing = !!initialData?.id

  // --- Estado del formulario ---
  const [patientId, setPatientId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [reason, setReason] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType>('Particular')
  const [epsName, setEpsName] = useState('')
  const [modality, setModality] = useState<AppointmentModality>('presencial')
  const [virtualLink, setVirtualLink] = useState('')

  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  // Calcular si la fecha/hora está dentro de la ventana de anticipación mínima
  const advanceWarning = (() => {
    if (!date || !time || !minBookingAdvanceHours || minBookingAdvanceHours === 0) return null
    const selectedDateTime = new Date(`${date}T${time}:00-05:00`)
    const now = new Date()
    const minAllowed = new Date(now.getTime() + minBookingAdvanceHours * 60 * 60 * 1000)
    if (selectedDateTime < minAllowed) {
      const label = minBookingAdvanceHours >= 24
        ? `${Math.round(minBookingAdvanceHours / 24)} día(s)`
        : `${minBookingAdvanceHours} horas`
      return `La anticipación mínima para pacientes es ${label}. Esta cita es más próxima, pero como administrador puedes agendarla.`
    }
    return null
  })()

  const overlayRef = useRef<HTMLDivElement>(null)

  // Cargar datos iniciales si estamos editando
  useEffect(() => {
    if (initialData) {
      setPatientId(initialData.patient_id)
      setPatientName(initialData.patient_name)
      setDoctorId(initialData.doctor_id)
      setDate(initialData.date)
      setTime(initialData.time)
      setDurationMinutes(initialData.duration_minutes || 30)
      setReason(initialData.reason || '')
      setPaymentType(initialData.payment_type || 'Particular')
      setEpsName(initialData.eps_name || '')
    } else {
      // Reset para creación nueva
      setPatientId('')
      setPatientName('')
      setDoctorId(doctors.length === 1 ? doctors[0].id : '')
      setDate('')
      setTime('')
      setDurationMinutes(30)
      setReason('')
      setPaymentType('Particular')
      setEpsName('')
      setModality('presencial')
      setVirtualLink('')
    }
    setError('')
    setFieldErrors({})
  }, [initialData, isOpen, doctors])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Click fuera del modal para cerrar
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose]
  )

  function validate(): boolean {
    const errors: Record<string, string> = {}

    if (!patientId) errors.patient = 'Selecciona un paciente'
    if (!doctorId) errors.doctor = 'Selecciona un doctor'
    if (!date) errors.date = 'Selecciona una fecha'
    if (!time) errors.time = 'Selecciona una hora'
    if (durationMinutes < 5 || durationMinutes > 480) {
      errors.duration = 'La duración debe estar entre 5 y 480 minutos'
    }
    if (paymentType === 'EPS' && !epsName) {
      errors.eps = 'Selecciona la EPS'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!validate()) return

    // Construir starts_at con offset Colombia (-05:00)
    const startsAt = `${date}T${time}:00-05:00`

    const input: AppointmentInput = {
      patient_id: patientId,
      doctor_id: doctorId,
      starts_at: startsAt,
      duration_minutes: durationMinutes,
      reason,
      payment_type: paymentType,
      eps_name: paymentType === 'EPS' ? epsName : '',
      modality,
      virtual_link: modality === 'virtual' ? virtualLink.trim() || null : null,
    }

    startTransition(async () => {
      const result = isEditing
        ? await updateAppointmentFromDashboard(initialData!.id, input)
        : await createAppointment(input)

      if (!result.ok) {
        setError(result.error ?? 'Error guardando la cita')
        return
      }

      onSaved()
      onClose()
    })
  }

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="card-v2 w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 p-6">
        {/* Encabezado */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEditing ? 'Editar cita' : 'Nueva cita'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Error general */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Paciente */}
          <div>
            <label className="label">Paciente</label>
            <PatientSearch
              value={patientId}
              onChange={(id, name) => {
                setPatientId(id)
                setPatientName(name)
                if (id) setFieldErrors((prev) => ({ ...prev, patient: '' }))
              }}
              placeholder="Buscar paciente por nombre o teléfono..."
            />
            {fieldErrors.patient && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.patient}</p>
            )}
          </div>

          {/* Doctor */}
          <div>
            <label className="label">Doctor</label>
            <select
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value)
                if (e.target.value) setFieldErrors((prev) => ({ ...prev, doctor: '' }))
              }}
              className="input-v2 w-full"
            >
              <option value="">Seleccionar doctor...</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.specialty ? ` — ${d.specialty}` : ''}
                </option>
              ))}
            </select>
            {fieldErrors.doctor && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.doctor}</p>
            )}
          </div>

          {/* Fecha y Hora en fila */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Fecha</label>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  if (e.target.value) setFieldErrors((prev) => ({ ...prev, date: '' }))
                }}
                className="input-v2 w-full"
              />
              {fieldErrors.date && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.date}</p>
              )}
            </div>
            <div>
              <label className="label">Hora</label>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value)
                  if (e.target.value) setFieldErrors((prev) => ({ ...prev, time: '' }))
                }}
                className="input-v2 w-full"
              />
              {fieldErrors.time && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.time}</p>
              )}
            </div>
          </div>

          {/* Warning anticipación mínima */}
          {advanceWarning && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
              {advanceWarning}
            </div>
          )}

          {/* Duración */}
          <div>
            <label className="label">Duración (minutos)</label>
            <input
              type="number"
              min={5}
              max={480}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="input-v2 w-24"
            />
            {fieldErrors.duration && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.duration}</p>
            )}
          </div>

          {/* Motivo */}
          <div>
            <label className="label">Motivo</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Consulta general, control, etc."
              className="input-v2 w-full"
            />
          </div>

          {/* Modalidad */}
          <div>
            <label className="label">Modalidad</label>
            <select
              value={modality}
              onChange={(e) => setModality(e.target.value as AppointmentModality)}
              className="input-v2 w-full"
            >
              <option value="presencial">Presencial</option>
              <option value="virtual">Virtual (videollamada)</option>
            </select>
          </div>

          {/* Link virtual (condicional) */}
          {modality === 'virtual' && (
            <div>
              <label className="label">
                Link de videollamada
                <span className="text-slate-400 font-normal ml-1">(opcional)</span>
              </label>
              <input
                type="url"
                value={virtualLink}
                onChange={(e) => setVirtualLink(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="input-v2 w-full"
              />
              <p className="text-xs text-slate-400 mt-1">
                Si no se proporciona, se generará automáticamente según la configuración del consultorio.
              </p>
            </div>
          )}

          {/* Tipo de pago */}
          <div>
            <label className="label">Tipo de pago</label>
            <select
              value={paymentType}
              onChange={(e) => {
                const val = e.target.value as PaymentType
                setPaymentType(val)
                if (val !== 'EPS') setEpsName('')
              }}
              className="input-v2 w-full"
            >
              {PAYMENT_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {pt}
                </option>
              ))}
            </select>
          </div>

          {/* EPS (condicional) */}
          {paymentType === 'EPS' && (
            <div>
              <label className="label">EPS</label>
              <select
                value={epsName}
                onChange={(e) => {
                  setEpsName(e.target.value)
                  if (e.target.value) setFieldErrors((prev) => ({ ...prev, eps: '' }))
                }}
                className="input-v2 w-full"
              >
                <option value="">Seleccionar EPS...</option>
                {EPS_OPTIONS.map((eps) => (
                  <option key={eps} value={eps}>
                    {eps}
                  </option>
                ))}
              </select>
              {fieldErrors.eps && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.eps}</p>
              )}
            </div>
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
              {isPending
                ? 'Guardando...'
                : isEditing
                  ? 'Guardar cambios'
                  : 'Agendar cita'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
