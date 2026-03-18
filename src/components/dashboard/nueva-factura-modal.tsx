'use client'

// ============================================================
// NuevaFacturaModal — Formulario para crear factura manual
// Permite facturar con o sin cita asociada
// ============================================================

import { useState } from 'react'
import { searchPatientsForSelect } from '@/app/actions/patients'
import { getPatientAppointmentsForInvoice, crearFacturaManual } from '@/app/actions/facturacion'
import type { PatientAppointmentOption } from '@/app/actions/facturacion'
import type { CollectionStatus } from '@/types/database'

interface Props {
  isOpen: boolean
  onClose: () => void
  defaultAmount: number
  onSaved: () => void
}

function todayStr(): string {
  const d = new Date()
  const col = new Date(d.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
  return `${col.getFullYear()}-${String(col.getMonth() + 1).padStart(2, '0')}-${String(col.getDate()).padStart(2, '0')}`
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Bogota',
  })
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
  rescheduled: 'Reagendada',
}

export function NuevaFacturaModal({ isOpen, onClose, defaultAmount, onSaved }: Props) {
  // Patient search
  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<{ id: string; name: string; phone: string }[]>([])
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string; phone: string } | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchingPatients, setSearchingPatients] = useState(false)

  // Patient appointments
  const [appointments, setAppointments] = useState<PatientAppointmentOption[]>([])
  const [loadingAppts, setLoadingAppts] = useState(false)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('')

  // Form fields
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayStr())
  const [invoiceAmount, setInvoiceAmount] = useState(defaultAmount)
  const [paymentType, setPaymentType] = useState('Particular')
  const [epsName, setEpsName] = useState('')
  const [collectionStatus, setCollectionStatus] = useState<CollectionStatus>('en_tramite')
  const [observations, setObservations] = useState('')

  // State
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  async function handlePatientSearch(query: string) {
    setPatientQuery(query)
    if (query.trim().length < 2) {
      setPatientResults([])
      setShowDropdown(false)
      return
    }
    setSearchingPatients(true)
    try {
      const results = await searchPatientsForSelect(query)
      setPatientResults(results)
      setShowDropdown(true)
    } finally {
      setSearchingPatients(false)
    }
  }

  async function handleSelectPatient(patient: { id: string; name: string; phone: string }) {
    setSelectedPatient(patient)
    setPatientQuery(patient.name)
    setShowDropdown(false)
    setPatientResults([])

    // Cargar citas del paciente
    setLoadingAppts(true)
    setSelectedAppointmentId('')
    try {
      const appts = await getPatientAppointmentsForInvoice(patient.id)
      setAppointments(appts)
    } finally {
      setLoadingAppts(false)
    }
  }

  function handleClearPatient() {
    setSelectedPatient(null)
    setPatientQuery('')
    setAppointments([])
    setSelectedAppointmentId('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!selectedPatient) {
      setError('Selecciona un paciente')
      return
    }
    if (!invoiceNumber.trim()) {
      setError('El número de factura es obligatorio')
      return
    }
    if (!invoiceAmount || invoiceAmount <= 0) {
      setError('El valor debe ser mayor a 0')
      return
    }

    setSaving(true)
    try {
      const result = await crearFacturaManual({
        patientId: selectedPatient.id,
        appointmentId: selectedAppointmentId || null,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        invoiceAmount,
        paymentType,
        epsName,
        collectionStatus,
        observations,
      })

      if (result.ok) {
        onSaved()
        resetForm()
        onClose()
      } else {
        setError(result.error ?? 'Error desconocido')
      }
    } catch {
      setError('Error de conexión')
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setSelectedPatient(null)
    setPatientQuery('')
    setAppointments([])
    setSelectedAppointmentId('')
    setInvoiceNumber('')
    setInvoiceDate(todayStr())
    setInvoiceAmount(defaultAmount)
    setPaymentType('Particular')
    setEpsName('')
    setCollectionStatus('en_tramite')
    setObservations('')
    setError('')
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Nueva factura</h2>
          <p className="text-xs text-slate-400 mt-0.5">Registrar factura manual con o sin cita asociada</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Paciente (searchable) */}
          <div>
            <label className="label">Paciente *</label>
            {selectedPatient ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="text-sm font-medium text-blue-800 flex-1">
                  {selectedPatient.name} <span className="text-blue-500 font-normal">({selectedPatient.phone})</span>
                </span>
                <button type="button" onClick={handleClearPatient} className="text-blue-400 hover:text-blue-600 text-xs">
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={patientQuery}
                  onChange={(e) => handlePatientSearch(e.target.value)}
                  onFocus={() => { if (patientResults.length > 0) setShowDropdown(true) }}
                  placeholder="Buscar por nombre o teléfono..."
                  autoFocus
                  className="input-field text-sm w-full"
                />
                {searchingPatients && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Buscando...</span>
                )}
                {showDropdown && patientResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {patientResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectPatient(p)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors"
                      >
                        <span className="text-sm font-medium text-slate-900">{p.name}</span>
                        <span className="text-xs text-slate-400 ml-2">{p.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showDropdown && patientQuery.trim().length >= 2 && patientResults.length === 0 && !searchingPatients && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-3">
                    <p className="text-sm text-slate-500">No se encontraron pacientes</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cita asociada (opcional) */}
          {selectedPatient && (
            <div>
              <label className="label">Cita asociada (opcional)</label>
              {loadingAppts ? (
                <p className="text-xs text-slate-400">Cargando citas...</p>
              ) : (
                <select
                  value={selectedAppointmentId}
                  onChange={(e) => setSelectedAppointmentId(e.target.value)}
                  className="input-field text-sm w-full"
                >
                  <option value="">Sin cita asociada</option>
                  {appointments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatDateShort(a.starts_at)} — {a.doctor_name} ({STATUS_LABELS[a.status] ?? a.status})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* N° Factura + Fecha */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">N° Factura *</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="FE-001234"
                autoComplete="off"
                className="input-field text-sm w-full"
              />
            </div>
            <div>
              <label className="label">Fecha emisión</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="input-field text-sm w-full"
              />
            </div>
          </div>

          {/* Valor + Tipo de pago */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Valor (COP) *</label>
              <input
                type="number"
                value={invoiceAmount}
                onChange={(e) => setInvoiceAmount(parseInt(e.target.value) || 0)}
                min={0}
                className="input-field text-sm w-full"
              />
            </div>
            <div>
              <label className="label">Tipo de pago</label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value)}
                className="input-field text-sm w-full"
              >
                <option value="Particular">Particular</option>
                <option value="EPS">EPS</option>
                <option value="Póliza">Póliza</option>
                <option value="ARL">ARL</option>
              </select>
            </div>
          </div>

          {/* EPS nombre (condicional) */}
          {paymentType === 'EPS' && (
            <div>
              <label className="label">Nombre de la EPS</label>
              <input
                type="text"
                value={epsName}
                onChange={(e) => setEpsName(e.target.value)}
                placeholder="Sura, Compensar, Nueva EPS..."
                className="input-field text-sm w-full"
              />
            </div>
          )}

          {/* Estado de cobro */}
          <div>
            <label className="label">Estado de cobro</label>
            <select
              value={collectionStatus}
              onChange={(e) => setCollectionStatus(e.target.value as CollectionStatus)}
              className="input-field text-sm w-full"
            >
              <option value="en_tramite">En trámite</option>
              <option value="cobrada">Cobrada</option>
              <option value="glosada">Glosada</option>
              <option value="vencida">Vencida</option>
            </select>
          </div>

          {/* Observaciones */}
          <div>
            <label className="label">Observaciones</label>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder="Opcional"
              rows={2}
              className="input-field text-sm w-full resize-none"
            />
          </div>

          {error && <p className="text-red-600 text-xs">{error}</p>}

          {/* Botones */}
          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary text-sm flex-1">
              {saving ? 'Guardando...' : 'Guardar factura'}
            </button>
            <button type="button" onClick={handleClose} className="btn-secondary text-sm">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
