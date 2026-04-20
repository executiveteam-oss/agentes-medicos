'use client'

// ============================================================
// WhatsAppConfigForm — Configuración del agente + gestión de doctores
// Secciones: Horario, Duración citas, Keywords, Doctores (CRUD completo)
// ============================================================

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { saveWhatsAppConfig } from '@/app/actions/whatsapp'
import {
  createDoctor,
  updateDoctor,
  toggleDoctorActive,
  deleteDoctor,
  closeDoctorAgenda,
  reopenDoctorAgenda,
  updateDoctorScheduleType,
  updateDoctorWorkingHours,
} from '@/app/actions/doctors'
import {
  normalizeWorkingHours,
  validateBlocks,
  defaultBlock,
  WORKING_HOURS_DAY_KEYS,
} from '@/lib/utils/working-hours'
import type { WorkingHours, NormalizedWorkingHours, WorkingBlock } from '@/types/database'
import {
  getStagingProducts,
  confirmImportForDoctor,
  cancelImport,
  type StagingDataResponse,
} from '@/app/actions/isalud-convenios'
import {
  getConsultationTypes,
  createConsultationType,
  updateConsultationType,
  deleteConsultationType,
  toggleConsultationType,
} from '@/app/actions/consultation-types'
import type { WhatsAppConfig, WhatsAppDoctorConfig, ConsultationType } from '@/types/database'
import type { DoctorForConfig } from '@/app/actions/whatsapp'
import { saveVacationMessage } from '@/app/actions/vacation'
import { formatCOP } from '@/lib/utils/dates'

const DAY_LABELS = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
]

const DURATION_OPTIONS = [20, 30, 45, 60]
const MAX_DURATION_OPTIONS = [30, 45, 60, 90]

// Especialidades comunes en Colombia
const DEFAULT_SPECIALTIES = [
  'Medicina General',
  'Ginecología',
  'Pediatría',
  'Fisioterapia',
  'Psicología',
  'Ortopedia',
  'Dermatología',
  'Cardiología',
  'Medicina Interna',
  'Neurología',
  'Oftalmología',
  'Otorrinolaringología',
  'Urología',
]

/** Retorna especialidades de la clínica si existen, defaults como fallback. "Otro" siempre al final. */
function getSpecialtyOptions(clinicSpecs: string[]): string[] {
  const base = clinicSpecs.length > 0 ? clinicSpecs.filter((s) => s.toLowerCase() !== 'otro') : DEFAULT_SPECIALTIES
  return [...base, 'Otro']
}

interface Props {
  initialConfig: WhatsAppConfig
  doctors: DoctorForConfig[]
  initialVacationMessage?: string | null
  clinicSpecialties?: string[]
  hasIsalud?: boolean
}

export function WhatsAppConfigForm({ initialConfig, doctors: initialDoctors, initialVacationMessage, clinicSpecialties = [], hasIsalud = false }: Props) {
  const [config, setConfig] = useState<WhatsAppConfig>(initialConfig)
  const [doctors, setDoctors] = useState<DoctorForConfig[]>(initialDoctors)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const keywordRef = useRef<HTMLInputElement>(null)

  // Vacation message
  const [vacationMsg, setVacationMsg] = useState(
    initialVacationMessage ?? 'Estamos de vacaciones del [fecha] al [fecha]. Regresamos el [fecha] con toda la energía. ¿Te agendamos para cuando volvamos?'
  )
  const [vacationMsgSaved, setVacationMsgSaved] = useState(false)

  function handleSaveVacationMsg() {
    startTransition(async () => {
      const result = await saveVacationMessage(vacationMsg)
      if (result.ok) setVacationMsgSaved(true)
    })
  }

  // Estado del formulario de nuevo doctor
  const [showAddDoctor, setShowAddDoctor] = useState(false)

  // Estado de edición inline por doctor
  const [editingDoctorId, setEditingDoctorId] = useState<string | null>(null)

  // Estado para confirmación de eliminación
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // --- Config schedule helpers ---

  function updateSchedule<K extends keyof WhatsAppConfig['schedule']>(
    key: K, value: WhatsAppConfig['schedule'][K]
  ) {
    setConfig((prev) => ({ ...prev, schedule: { ...prev.schedule, [key]: value } }))
  }

  function toggleDay(day: number) {
    setConfig((prev) => {
      const days = prev.schedule.days.includes(day)
        ? prev.schedule.days.filter((d) => d !== day)
        : [...prev.schedule.days, day].sort()
      return { ...prev, schedule: { ...prev.schedule, days } }
    })
  }

  function addKeyword(keyword: string) {
    const trimmed = keyword.trim().toLowerCase()
    if (!trimmed || config.escalation_keywords.includes(trimmed)) return
    setConfig((prev) => ({
      ...prev,
      escalation_keywords: [...prev.escalation_keywords, trimmed],
    }))
  }

  function removeKeyword(keyword: string) {
    setConfig((prev) => ({
      ...prev,
      escalation_keywords: prev.escalation_keywords.filter((k) => k !== keyword),
    }))
  }

  function handleKeywordKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addKeyword(e.currentTarget.value)
      e.currentTarget.value = ''
    }
  }

  // --- Doctor config (schedule in whatsapp_config jsonb) ---

  function updateDoctorConfig(doctorId: string, updates: Partial<WhatsAppDoctorConfig>) {
    setConfig((prev) => {
      const existing = prev.doctors[doctorId] ?? {
        active: true,
        days: prev.schedule.days,
        start: prev.schedule.start,
        end: prev.schedule.end,
        duration: prev.appointment.default_duration,
      }
      return {
        ...prev,
        doctors: { ...prev.doctors, [doctorId]: { ...existing, ...updates } },
      }
    })
  }

  function toggleDoctorDay(doctorId: string, day: number) {
    const dc = config.doctors[doctorId]
    const currentDays = dc?.days ?? config.schedule.days
    const newDays = currentDays.includes(day)
      ? currentDays.filter((d) => d !== day)
      : [...currentDays, day].sort()
    updateDoctorConfig(doctorId, { days: newDays })
  }

  // --- Save global config ---

  function handleSave() {
    setSaved(false)
    setError(null)
    startTransition(async () => {
      const result = await saveWhatsAppConfig(config)
      if (result.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(result.error ?? 'Error desconocido')
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}

      {/* 1. Horario de citas disponibles */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Horario de citas disponibles</h3>
        <p className="text-xs text-slate-400 mb-4">El agente responde 24/7. Este horario define cuándo se pueden agendar citas.</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Hora inicio</label>
            <input
              type="time"
              value={config.schedule.start}
              onChange={(e) => updateSchedule('start', e.target.value)}
              className="input-field mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Hora fin</label>
            <input
              type="time"
              value={config.schedule.end}
              onChange={(e) => updateSchedule('end', e.target.value)}
              className="input-field mt-1"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">Días con citas</label>
          <div className="flex gap-2">
            {DAY_LABELS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  config.schedule.days.includes(d.value)
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Duración de citas */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Duración de citas</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Duración por defecto</label>
            <select
              value={config.appointment.default_duration}
              onChange={(e) => setConfig((prev) => ({
                ...prev,
                appointment: { ...prev.appointment, default_duration: Number(e.target.value) },
              }))}
              className="input-field mt-1 w-full"
            >
              {DURATION_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Duración máxima</label>
            <select
              value={config.appointment.max_duration}
              onChange={(e) => setConfig((prev) => ({
                ...prev,
                appointment: { ...prev.appointment, max_duration: Number(e.target.value) },
              }))}
              className="input-field mt-1 w-full"
            >
              {MAX_DURATION_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 3. Palabras clave de escalamiento */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Palabras clave para escalar a humano</h3>
        <p className="text-xs text-slate-400 mb-4">Si el paciente menciona alguna de estas palabras, se escala inmediatamente</p>

        <div className="flex flex-wrap gap-2 mb-3">
          {config.escalation_keywords.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium"
            >
              {kw}
              <button
                type="button"
                onClick={() => removeKeyword(kw)}
                className="ml-0.5 text-slate-400 hover:text-red-500 transition-colors"
              >
                &times;
              </button>
            </span>
          ))}
        </div>

        <input
          ref={keywordRef}
          type="text"
          placeholder="Escribe una palabra y presiona Enter..."
          onKeyDown={handleKeywordKeyDown}
          className="input-field w-full"
        />
      </div>

      {/* 4. Doctores — CRUD completo + configuración de agenda */}
      <div id="doctores" className="card p-5 scroll-mt-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Doctores</h3>
            <p className="text-xs text-slate-400 mt-0.5">Gestiona médicos, horarios y tipos de consulta</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddDoctor(!showAddDoctor)}
            className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
          >
            {showAddDoctor ? 'Cancelar' : '+ Agregar doctor'}
          </button>
        </div>

        {/* Add doctor form */}
        {showAddDoctor && (
          <AddDoctorForm
            onCreated={(doc) => {
              setDoctors((prev) => [...prev, doc])
              setShowAddDoctor(false)
              showToast(`Doctor ${doc.name} creado`)
            }}
            onCancel={() => setShowAddDoctor(false)}
            clinicSpecialties={clinicSpecialties}
          />
        )}

        {/* Doctor cards */}
        {doctors.length === 0 && !showAddDoctor ? (
          <p className="text-slate-400 text-sm py-4 text-center">No hay doctores registrados</p>
        ) : (
          <div className="space-y-4">
            {doctors.map((doc) => {
              const dc = config.doctors[doc.id]
              const isActive = dc?.active ?? doc.is_active
              const docDuration = dc?.duration ?? config.appointment.default_duration

              return (
                <DoctorCard
                  key={doc.id}
                  doc={doc}
                  isActive={isActive}
                  isEditing={editingDoctorId === doc.id}
                  isConfirmingDelete={confirmDeleteId === doc.id}
                  docDuration={docDuration}
                  clinicSpecialties={clinicSpecialties}
                  hasIsalud={hasIsalud}
                  onWorkingHoursSaved={(wh) => {
                    setDoctors((prev) =>
                      prev.map((d) => (d.id === doc.id ? { ...d, working_hours: wh } : d))
                    )
                    showToast(`Horario de ${doc.name} actualizado`)
                  }}
                  onToggleActive={(active) => {
                    setDoctors((prev) =>
                      prev.map((d) => (d.id === doc.id ? { ...d, is_active: active } : d))
                    )
                    updateDoctorConfig(doc.id, { active })
                    toggleDoctorActive(doc.id, active)
                    showToast(active ? `${doc.name} activado` : `${doc.name} desactivado`)
                  }}
                  onAgendaChange={async (closed, reason, until) => {
                    if (closed) {
                      const result = await closeDoctorAgenda(doc.id, reason ?? null, until ?? null)
                      if (result.ok) {
                        setDoctors((prev) =>
                          prev.map((d) => d.id === doc.id ? { ...d, agenda_closed: true, agenda_closed_reason: reason ?? null, agenda_closed_until: until ?? null } : d)
                        )
                        showToast(`Agenda de ${doc.name} cerrada`)
                      }
                    } else {
                      const result = await reopenDoctorAgenda(doc.id)
                      if (result.ok) {
                        setDoctors((prev) =>
                          prev.map((d) => d.id === doc.id ? { ...d, agenda_closed: false, agenda_closed_reason: null, agenda_closed_until: null } : d)
                        )
                        showToast(`Agenda de ${doc.name} reabierta`)
                      }
                    }
                  }}
                  onScheduleTypeChange={async (type, message) => {
                    const result = await updateDoctorScheduleType(doc.id, type, message)
                    if (result.ok) {
                      setDoctors((prev) =>
                        prev.map((d) => d.id === doc.id ? { ...d, schedule_type: type, manual_availability_message: message } : d)
                      )
                      showToast(type === 'manual' ? `${doc.name}: disponibilidad manual` : `${doc.name}: horario fijo`)
                    }
                  }}
                  onStartEdit={() => setEditingDoctorId(doc.id)}
                  onCancelEdit={() => setEditingDoctorId(null)}
                  onSaveEdit={(name, specialty) => {
                    setDoctors((prev) =>
                      prev.map((d) => (d.id === doc.id ? { ...d, name, specialty: specialty || null } : d))
                    )
                    setEditingDoctorId(null)
                    showToast(`Doctor ${name} actualizado`)
                  }}
                  onStartDelete={() => setConfirmDeleteId(doc.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                  onConfirmDelete={() => {
                    setDoctors((prev) => prev.filter((d) => d.id !== doc.id))
                    // Also remove from whatsapp config
                    setConfig((prev) => {
                      const { [doc.id]: _, ...rest } = prev.doctors
                      return { ...prev, doctors: rest }
                    })
                    setConfirmDeleteId(null)
                    showToast(`Doctor ${doc.name} eliminado`)
                  }}
                  onChangeDuration={(v) => updateDoctorConfig(doc.id, { duration: v })}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* 5. Automatizaciones */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Automatizaciones</h3>
        <p className="text-xs text-slate-400 mb-4">Mensajes automáticos que el agente envía sin intervención manual</p>

        <div className="space-y-4">
          {/* Seguimiento post-consulta */}
          <div className="flex items-start justify-between gap-4 p-3 border border-slate-100 rounded-lg">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">Seguimiento post-consulta</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Envía mensaje automático 24h después de cada cita completada y solicita calificación
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfig((prev) => ({
                ...prev,
                automations: {
                  ...prev.automations,
                  post_consulta: { enabled: !prev.automations.post_consulta.enabled },
                },
              }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                config.automations.post_consulta.enabled ? 'bg-blue-700' : 'bg-slate-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                  config.automations.post_consulta.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Reactivación de pacientes inactivos */}
          <div className="p-3 border border-slate-100 rounded-lg space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">Reactivación de pacientes inactivos</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Contacta pacientes que no han visitado el consultorio en el tiempo configurado
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfig((prev) => ({
                  ...prev,
                  automations: {
                    ...prev.automations,
                    reactivacion: { ...prev.automations.reactivacion, enabled: !prev.automations.reactivacion.enabled },
                  },
                }))}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                  config.automations.reactivacion.enabled ? 'bg-blue-700' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                    config.automations.reactivacion.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {config.automations.reactivacion.enabled && (
              <div className="pt-1">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Días de inactividad
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={30}
                    max={365}
                    value={config.automations.reactivacion.days_inactive}
                    onChange={(e) => setConfig((prev) => ({
                      ...prev,
                      automations: {
                        ...prev.automations,
                        reactivacion: { ...prev.automations.reactivacion, days_inactive: Math.max(30, Number(e.target.value) || 90) },
                      },
                    }))}
                    className="input-field w-24"
                  />
                  <span className="text-xs text-slate-400">días sin visita</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 6. Mensaje de vacaciones */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Mensaje de vacaciones</h3>
        <p className="text-xs text-slate-400 mb-3">
          Cuando cierres la agenda por vacaciones, el agente responderá con este mensaje.
          Usa [fecha] como marcador para la fecha de regreso.
        </p>
        <textarea
          value={vacationMsg}
          onChange={(e) => { setVacationMsg(e.target.value); setVacationMsgSaved(false) }}
          rows={3}
          className="input-field w-full resize-none"
          placeholder="Estamos de vacaciones del [fecha] al [fecha]. ¿Te agendamos para cuando volvamos?"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleSaveVacationMsg}
            disabled={isPending}
            className="text-xs font-medium text-blue-700 hover:text-blue-800"
          >
            {isPending ? 'Guardando...' : 'Guardar mensaje'}
          </button>
          {vacationMsgSaved && <span className="text-xs text-emerald-600">Guardado</span>}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="btn-primary"
        >
          {isPending ? 'Guardando...' : 'Guardar configuración'}
        </button>
        {saved && <span className="text-sm text-emerald-600 font-medium">Guardado</span>}
        {error && <span className="text-sm text-red-600 font-medium">{error}</span>}
      </div>
    </div>
  )
}

// ============================================================
// AddDoctorForm — Formulario inline para agregar doctor
// ============================================================

function AddDoctorForm({
  onCreated,
  onCancel,
  clinicSpecialties = [],
}: {
  onCreated: (doc: DoctorForConfig) => void
  onCancel: () => void
  clinicSpecialties: string[]
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = (form.get('name') as string).trim()
    const specialty = (form.get('specialty') as string).trim()
    const phone = (form.get('phone') as string).trim()

    if (!name) {
      setError('El nombre es obligatorio')
      nameRef.current?.focus()
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await createDoctor({ name, specialty, phone })
      if (result.ok && result.doctor) {
        onCreated({
          id: result.doctor.id,
          name: result.doctor.name,
          specialty: result.doctor.specialty,
          phone: result.doctor.phone,
          is_active: true,
          agenda_closed: false,
          agenda_closed_reason: null,
          agenda_closed_until: null,
          schedule_type: 'fixed',
          manual_availability_message: null,
          working_hours: null,
        })
      } else {
        setError(result.error ?? 'Error desconocido')
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onCancel()
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 mb-4"
    >
      <p className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-3">Nuevo doctor</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Nombre completo *</label>
          <input
            ref={nameRef}
            name="name"
            type="text"
            placeholder="Dr. Juan Pérez"
            className="input-field w-full"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Especialidad</label>
          <select name="specialty" className="input-field w-full">
            <option value="">Seleccionar...</option>
            {getSpecialtyOptions(clinicSpecialties).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Teléfono</label>
          <input
            name="phone"
            type="tel"
            placeholder="310 123 4567"
            className="input-field w-full"
          />
        </div>
      </div>

      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}

      <div className="flex items-center gap-2 mt-3">
        <button type="submit" disabled={isPending} className="btn-primary text-sm">
          {isPending ? 'Creando...' : 'Crear doctor'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2"
        >
          Cancelar
        </button>
        <span className="text-xs text-slate-400 ml-auto">Enter para guardar · Esc para cancelar</span>
      </div>
    </form>
  )
}

// ============================================================
// DoctorCard — Una tarjeta por doctor con edit/delete/schedule
// ============================================================

function DoctorCard({
  doc,
  isActive,
  isEditing,
  isConfirmingDelete,
  docDuration,
  clinicSpecialties,
  hasIsalud,
  onToggleActive,
  onAgendaChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onChangeDuration,
  onScheduleTypeChange,
  onWorkingHoursSaved,
}: {
  doc: DoctorForConfig
  isActive: boolean
  isEditing: boolean
  isConfirmingDelete: boolean
  docDuration: number
  hasIsalud: boolean
  onToggleActive: (active: boolean) => void
  onAgendaChange: (closed: boolean, reason?: string | null, until?: string | null) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (name: string, specialty: string) => void
  onStartDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onChangeDuration: (v: number) => void
  onScheduleTypeChange: (type: 'fixed' | 'manual', message: string | null) => void
  onWorkingHoursSaved: (wh: WorkingHours) => void
  clinicSpecialties: string[]
}) {
  const agendaClosed = doc.agenda_closed ?? false
  const scheduleType = doc.schedule_type ?? 'fixed'

  return (
    <div className={`border rounded-xl p-4 transition-colors ${!isActive ? 'border-slate-200 bg-slate-50/80' : agendaClosed ? 'border-red-200 bg-red-50/30' : 'border-slate-200'}`}>
      {/* Header */}
      {isEditing ? (
        <EditDoctorInline
          doc={doc}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
          clinicSpecialties={clinicSpecialties}
        />
      ) : (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className={`text-sm font-medium truncate ${isActive && !agendaClosed ? 'text-slate-900' : 'text-slate-400'}`}>
                  {doc.name}
                </p>
                {isActive && (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    agendaClosed
                      ? 'bg-red-100 text-red-700 border border-red-200'
                      : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${agendaClosed ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    {agendaClosed ? 'Agenda cerrada' : 'Agenda abierta'}
                  </span>
                )}
              </div>
              <p className={`text-xs ${doc.specialty ? 'text-slate-400' : 'text-amber-500'}`}>{doc.specialty ?? 'Sin especialidad asignada'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onStartEdit}
              className="text-xs text-slate-400 hover:text-blue-700 transition-colors px-1.5 py-1"
              title="Editar"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => onToggleActive(!isActive)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-600 border-red-200'
              }`}
            >
              {isActive ? 'Activo' : 'Inactivo'}
            </button>
            <button
              type="button"
              onClick={onStartDelete}
              className="text-xs text-slate-300 hover:text-red-500 transition-colors px-1.5 py-1"
              title="Eliminar"
            >
              Eliminar
            </button>
          </div>
        </div>
      )}

      {/* Agenda closed banner */}
      {isActive && !isEditing && !isConfirmingDelete && agendaClosed && (
        <AgendaClosedBanner doc={doc} onReopen={() => onAgendaChange(false)} />
      )}

      {/* Delete confirmation */}
      {isConfirmingDelete && (
        <DeleteConfirmation
          doctorId={doc.id}
          doctorName={doc.name}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}

      {/* Schedule (only when active, not editing, and agenda open) */}
      {isActive && !isEditing && !isConfirmingDelete && !agendaClosed && (
        <div className="space-y-3">
          {/* Close agenda toggle */}
          <CloseAgendaToggle doc={doc} onClose={(reason, until) => onAgendaChange(true, reason, until)} />

          {/* Schedule type toggle */}
          <ScheduleTypeToggle
            scheduleType={scheduleType}
            manualMessage={doc.manual_availability_message}
            onChange={onScheduleTypeChange}
          />

          {/* Fixed schedule: per-day blocks editor + duration */}
          {scheduleType === 'fixed' && (
            <>
              <DoctorScheduleEditor
                doctorId={doc.id}
                initialWorkingHours={doc.working_hours}
                onSaved={onWorkingHoursSaved}
              />

              {/* Duration */}
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Duración por defecto</label>
                <select
                  value={docDuration}
                  onChange={(e) => onChangeDuration(Number(e.target.value))}
                  className="input-field mt-1 w-full max-w-[160px]"
                >
                  {DURATION_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m} min</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Tipos de consulta */}
          <ConsultationTypesSection doctorId={doc.id} doctorName={doc.name} hasIsalud={hasIsalud} />
        </div>
      )}
    </div>
  )
}

// ============================================================
// AgendaClosedBanner — Muestra info de agenda cerrada + botón reabrir
// ============================================================

function AgendaClosedBanner({
  doc,
  onReopen,
}: {
  doc: DoctorForConfig
  onReopen: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleReopen() {
    startTransition(async () => {
      onReopen()
    })
  }

  const untilText = doc.agenda_closed_until
    ? `hasta el ${new Date(doc.agenda_closed_until + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'indefinidamente'

  return (
    <div className="bg-red-50 text-red-600 border border-red-200 rounded-lg px-3 py-2 space-y-2">
      <div>
        <p className="text-sm font-medium">🔴 Agenda cerrada {untilText}</p>
        {doc.agenda_closed_reason && (
          <p className="text-xs text-red-500 mt-0.5">Motivo: {doc.agenda_closed_reason}</p>
        )}
        <p className="text-[10px] text-red-400 mt-1">El agente no ofrecerá citas con este doctor mientras la agenda esté cerrada.</p>
      </div>
      <button
        type="button"
        onClick={handleReopen}
        disabled={isPending}
        className="text-xs font-medium py-1.5 px-3 rounded-lg border border-slate-300 text-slate-500 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        {isPending ? 'Reabriendo...' : 'Reabrir agenda'}
      </button>
    </div>
  )
}

// ============================================================
// CloseAgendaToggle — Formulario inline para cerrar agenda
// ============================================================

function CloseAgendaToggle({
  doc,
  onClose,
}: {
  doc: DoctorForConfig
  onClose: (reason: string | null, until: string | null) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleClose() {
    startTransition(async () => {
      onClose(reason.trim() || null, until || null)
      setShowForm(false)
      setReason('')
      setUntil('')
    })
  }

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="text-xs font-medium py-1.5 px-3 rounded-lg border border-slate-300 text-slate-500 bg-white hover:bg-slate-50 transition-colors"
      >
        Cerrar agenda temporalmente
      </button>
    )
  }

  // Min date = today
  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="bg-red-50/50 border border-red-100 rounded-lg p-3 space-y-2.5">
      <p className="text-xs font-semibold text-red-700 uppercase tracking-wider">Cerrar agenda</p>
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">Motivo (opcional)</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="input-field w-full"
          placeholder="Vacaciones, incapacidad, etc."
        />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">¿Hasta cuándo? (opcional)</label>
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          min={today}
          className="input-field w-full"
        />
        <p className="text-[10px] text-slate-400 mt-0.5">Si no se establece, la agenda queda cerrada indefinidamente.</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleClose}
          disabled={isPending}
          className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? 'Cerrando...' : 'Cerrar agenda'}
        </button>
        <button
          type="button"
          onClick={() => { setShowForm(false); setReason(''); setUntil('') }}
          className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ============================================================
// ScheduleTypeToggle — Horario fijo vs Disponibilidad manual
// ============================================================

const DEFAULT_MANUAL_MESSAGE = 'Este médico no tiene horario fijo. Déjanos tu nombre y el servicio que necesitas y te contactaremos para confirmar tu cita.'

function ScheduleTypeToggle({
  scheduleType,
  manualMessage,
  onChange,
}: {
  scheduleType: 'fixed' | 'manual'
  manualMessage: string | null
  onChange: (type: 'fixed' | 'manual', message: string | null) => void
}) {
  const [localMessage, setLocalMessage] = useState(manualMessage ?? DEFAULT_MANUAL_MESSAGE)

  return (
    <div>
      <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
        Tipo de horario
      </label>
      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={() => onChange('fixed', null)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            scheduleType === 'fixed'
              ? 'bg-blue-700 text-white border-blue-700'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          Horario fijo
        </button>
        <button
          type="button"
          onClick={() => onChange('manual', localMessage)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            scheduleType === 'manual'
              ? 'bg-amber-600 text-white border-amber-600'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          Disponibilidad manual
        </button>
      </div>
      {scheduleType === 'manual' && (
        <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-3 space-y-2">
          <p className="text-xs text-amber-700 font-medium">
            Las citas se gestionan manualmente. El agente recogerá datos del paciente y creará una solicitud en la lista de espera.
          </p>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Mensaje para pacientes</label>
            <textarea
              value={localMessage}
              onChange={(e) => setLocalMessage(e.target.value)}
              onBlur={() => onChange('manual', localMessage)}
              rows={3}
              className="input-field w-full text-sm"
              placeholder={DEFAULT_MANUAL_MESSAGE}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// ConsultationTypesSection — Tipos de consulta por doctor
// ============================================================

const CT_DURATION_OPTIONS = [15, 20, 30, 45, 60, 90]

function ConsultationTypesSection({ doctorId, doctorName, hasIsalud }: { doctorId: string; doctorName: string; hasIsalud: boolean }) {
  const [types, setTypes] = useState<ConsultationType[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showIsaludModal, setShowIsaludModal] = useState(false)

  const loadTypes = useCallback(async () => {
    const data = await getConsultationTypes(doctorId)
    setTypes(data)
    setLoaded(true)
  }, [doctorId])

  useEffect(() => {
    if (expanded && !loaded) {
      loadTypes()
    }
  }, [expanded, loaded, loadTypes])

  return (
    <div className="border-t border-slate-100 pt-3 mt-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left group"
      >
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer">
            Tipos de consulta
          </label>
          {loaded && types.length > 0 && (
            <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{types.filter((t) => t.is_active).length}</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {!loaded ? (
            <p className="text-xs text-slate-400 py-2">Cargando...</p>
          ) : types.length === 0 && !showAdd ? (
            <p className="text-xs text-slate-400 py-2">Sin tipos de consulta. El agente usará la duración por defecto.</p>
          ) : (
            types.map((ct) => (
              editingId === ct.id ? (
                <ConsultationTypeForm
                  key={ct.id}
                  initial={ct}
                  onSave={async (input) => {
                    const result = await updateConsultationType(ct.id, input)
                    if (result.ok) {
                      setTypes((prev) => prev.map((t) => t.id === ct.id ? {
                        ...t,
                        ...input,
                        preparation_instructions: input.requires_preparation ? (input.preparation_instructions ?? null) : null,
                        required_documents_description: input.requires_documents ? (input.required_documents_description ?? null) : null,
                      } : t))
                      setEditingId(null)
                    }
                    return result
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : deletingId === ct.id ? (
                <div key={ct.id} className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
                  <p className="text-xs text-red-700">¿Eliminar &quot;{ct.name}&quot;?</p>
                  <div className="flex gap-2">
                    <DeleteCtButton id={ct.id} onDeleted={() => { setTypes((prev) => prev.filter((t) => t.id !== ct.id)); setDeletingId(null) }} onError={() => setDeletingId(null)} />
                    <button type="button" onClick={() => setDeletingId(null)} className="text-xs text-slate-500 px-2 py-1">No</button>
                  </div>
                </div>
              ) : (
                <div key={ct.id} className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border transition-colors ${ct.is_active ? 'border-slate-100 bg-white' : 'border-slate-100 bg-slate-50/60'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${ct.is_active ? 'text-slate-900' : 'text-slate-400'}`}>{ct.name}</span>
                      {ct.eps_name && (
                        <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-200">{ct.eps_name}</span>
                      )}
                      <span className="text-xs text-slate-400">{ct.duration_minutes} min</span>
                      {ct.requires_preparation && (
                        <span className="text-[10px] font-medium bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full border border-amber-200">
                          Preparación
                        </span>
                      )}
                      {!ct.requires_preparation && (
                        <span className="text-[10px] font-medium bg-slate-50 text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-200">
                          Sin preparación
                        </span>
                      )}
                      {ct.price != null && ct.price > 0 && (
                        <span className="text-xs text-emerald-600 font-medium">{formatCOP(ct.price)}</span>
                      )}
                      {ct.modality !== 'presencial' && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                          ct.modality === 'virtual'
                            ? 'bg-violet-50 text-violet-700 border-violet-200'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}>
                          {ct.modality === 'virtual' ? 'Virtual' : 'Presencial/Virtual'}
                        </span>
                      )}
                      {!ct.bookable_via_whatsapp && (
                        <span className="text-[10px] font-medium bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full border border-red-200">
                          No WhatsApp
                        </span>
                      )}
                      {ct.requires_documents && (
                        <span className="text-[10px] font-medium bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full border border-purple-200">
                          Documentos
                        </span>
                      )}
                    </div>
                    {ct.requires_preparation && ct.preparation_instructions && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{ct.preparation_instructions}</p>
                    )}
                    {ct.requires_documents && ct.required_documents_description && (
                      <p className="text-xs text-purple-400 mt-0.5 truncate">{ct.required_documents_description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => setEditingId(ct.id)} className="text-xs text-slate-400 hover:text-blue-700 px-1.5 py-1">Editar</button>
                    <ToggleCtButton ct={ct} onToggled={(active) => setTypes((prev) => prev.map((t) => t.id === ct.id ? { ...t, is_active: active } : t))} />
                    <button type="button" onClick={() => setDeletingId(ct.id)} className="text-xs text-slate-300 hover:text-red-500 px-1.5 py-1">×</button>
                  </div>
                </div>
              )
            ))
          )}

          {showAdd ? (
            <ConsultationTypeForm
              doctorId={doctorId}
              onSave={async (input) => {
                const result = await createConsultationType({ ...input, doctor_id: doctorId })
                if (result.ok && result.data) {
                  setTypes((prev) => [...prev, result.data!])
                  setShowAdd(false)
                }
                return result
              }}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="text-xs text-blue-700 hover:text-blue-800 font-medium py-1.5"
              >
                + Agregar tipo de consulta
              </button>
              {hasIsalud && (
                <button
                  type="button"
                  onClick={() => setShowIsaludModal(true)}
                  className="text-xs text-[#028090] hover:text-[#026d7a] font-medium py-1.5 inline-flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  Importar desde iSalud
                </button>
              )}
            </div>
          )}

          {showIsaludModal && (
            <ImportIsaludModal
              doctorId={doctorId}
              doctorName={doctorName}
              onClose={() => setShowIsaludModal(false)}
              onImported={async () => {
                // Refrescar tipos del doctor para que aparezcan los recién creados
                const fresh = await getConsultationTypes(doctorId)
                setTypes(fresh)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// --- Formulario para crear/editar tipo de consulta ---
function ConsultationTypeForm({
  initial,
  doctorId,
  onSave,
  onCancel,
}: {
  initial?: ConsultationType
  doctorId?: string
  onSave: (input: { name: string; duration_minutes: number; requires_preparation: boolean; preparation_instructions: string | null; price: number | null; is_active: boolean; bookable_via_whatsapp: boolean; requires_documents: boolean; required_documents_description: string | null; modality: 'presencial' | 'virtual' | 'ambas'; eps_name: string | null }) => Promise<{ ok: boolean; error?: string }>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [epsName, setEpsName] = useState(initial?.eps_name ?? '')
  const [duration, setDuration] = useState(initial?.duration_minutes ?? 30)
  const [requiresPrep, setRequiresPrep] = useState(initial?.requires_preparation ?? false)
  const [prepInstructions, setPrepInstructions] = useState(initial?.preparation_instructions ?? '')
  const [price, setPrice] = useState<string>(initial?.price != null ? String(initial.price) : '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [bookableViaWhatsapp, setBookableViaWhatsapp] = useState(initial?.bookable_via_whatsapp ?? true)
  const [requiresDocs, setRequiresDocs] = useState(initial?.requires_documents ?? false)
  const [docsDescription, setDocsDescription] = useState(initial?.required_documents_description ?? '')
  const [modality, setModality] = useState<'presencial' | 'virtual' | 'ambas'>(initial?.modality ?? 'presencial')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!name.trim()) { setError('El nombre es obligatorio'); return }
    setError(null)
    startTransition(async () => {
      const result = await onSave({
        name: name.trim(),
        duration_minutes: duration,
        requires_preparation: requiresPrep,
        preparation_instructions: requiresPrep ? prepInstructions.trim() || null : null,
        price: price ? parseInt(price, 10) || null : null,
        is_active: isActive,
        bookable_via_whatsapp: bookableViaWhatsapp,
        requires_documents: requiresDocs,
        required_documents_description: requiresDocs ? docsDescription.trim() || null : null,
        modality,
        eps_name: epsName.trim() || null,
      })
      if (!result.ok) setError(result.error ?? 'Error')
    })
  }

  return (
    <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Nombre</label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field w-full"
            placeholder="Consulta general"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Duración</label>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input-field w-full">
            {CT_DURATION_OPTIONS.map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </div>
      </div>

      {/* EPS / Entidad */}
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">EPS / Entidad (opcional)</label>
        <input
          value={epsName}
          onChange={(e) => setEpsName(e.target.value)}
          className="input-field w-full"
          placeholder="Ej: Sura, Allianz, Particular..."
        />
      </div>

      {/* Modalidad */}
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">Modalidad</label>
        <select
          value={modality}
          onChange={(e) => setModality(e.target.value as 'presencial' | 'virtual' | 'ambas')}
          className="input-field w-full"
        >
          <option value="presencial">Presencial</option>
          <option value="virtual">Virtual</option>
          <option value="ambas">Ambas (presencial o virtual)</option>
        </select>
        {modality === 'ambas' && (
          <p className="text-[10px] text-slate-400 mt-0.5">El agente le preguntará al paciente si prefiere presencial o virtual.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Precio (COP, opcional)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input-field w-full"
            placeholder="80000"
            min={0}
          />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              isActive
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-600 border-red-200'
            }`}
          >
            {isActive ? 'Activo' : 'Inactivo'}
          </button>
        </div>
      </div>

      {/* Preparación previa */}
      <div className="flex items-start justify-between gap-3 p-2.5 border border-slate-100 rounded-lg bg-white">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">¿Requiere preparación previa?</p>
          <p className="text-[10px] text-slate-400">Ej: ayunas, no aplicar cremas, etc.</p>
        </div>
        <button
          type="button"
          onClick={() => setRequiresPrep(!requiresPrep)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            requiresPrep ? 'bg-blue-700' : 'bg-slate-200'
          }`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            requiresPrep ? 'translate-x-4' : 'translate-x-0'
          }`} />
        </button>
      </div>

      {requiresPrep && (
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Instrucciones de preparación</label>
          <textarea
            value={prepInstructions}
            onChange={(e) => setPrepInstructions(e.target.value)}
            className="input-field w-full resize-none"
            rows={2}
            placeholder="Venir en ayunas 8 horas antes"
          />
        </div>
      )}

      {/* Agendable por WhatsApp */}
      <div className="flex items-start justify-between gap-3 p-2.5 border border-slate-100 rounded-lg bg-white">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">Agendable por WhatsApp</p>
          <p className="text-[10px] text-slate-400">Si está apagado, el agente no ofrecerá este servicio</p>
        </div>
        <button
          type="button"
          onClick={() => setBookableViaWhatsapp(!bookableViaWhatsapp)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            bookableViaWhatsapp ? 'bg-blue-700' : 'bg-slate-200'
          }`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            bookableViaWhatsapp ? 'translate-x-4' : 'translate-x-0'
          }`} />
        </button>
      </div>

      {/* Requiere documentos previos */}
      <div className="flex items-start justify-between gap-3 p-2.5 border border-slate-100 rounded-lg bg-white">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">Requiere documentos previos</p>
          <p className="text-[10px] text-slate-400">Ej: historia clínica, orden médica, etc.</p>
        </div>
        <button
          type="button"
          onClick={() => setRequiresDocs(!requiresDocs)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            requiresDocs ? 'bg-blue-700' : 'bg-slate-200'
          }`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            requiresDocs ? 'translate-x-4' : 'translate-x-0'
          }`} />
        </button>
      </div>

      {requiresDocs && (
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Instrucciones de documentos</label>
          <textarea
            value={docsDescription}
            onChange={(e) => setDocsDescription(e.target.value)}
            className="input-field w-full resize-none"
            rows={2}
            placeholder="Enviar historia clínica u orden médica antes de la cita"
          />
        </div>
      )}

      {error && <p className="text-red-600 text-xs">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={isPending}
          className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? 'Guardando...' : initial ? 'Actualizar' : 'Crear'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5">
          Cancelar
        </button>
      </div>
    </div>
  )
}

// --- Botones auxiliares ---
function ToggleCtButton({ ct, onToggled }: { ct: ConsultationType; onToggled: (active: boolean) => void }) {
  const [isPending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await toggleConsultationType(ct.id, !ct.is_active)
          if (result.ok) onToggled(!ct.is_active)
        })
      }}
      className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-colors ${
        ct.is_active
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-slate-50 text-slate-400 border-slate-200'
      }`}
    >
      {ct.is_active ? 'On' : 'Off'}
    </button>
  )
}

function DeleteCtButton({ id, onDeleted, onError }: { id: string; onDeleted: () => void; onError: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await deleteConsultationType(id)
            if (result.ok) { onDeleted() }
            else { setError(result.error ?? 'Error'); setTimeout(onError, 2000) }
          })
        }}
        className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-1 px-2.5 rounded-lg transition-colors disabled:opacity-50"
      >
        {isPending ? '...' : 'Sí'}
      </button>
      {error && <p className="text-red-600 text-[10px] mt-0.5">{error}</p>}
    </div>
  )
}

// ============================================================
// EditDoctorInline — Edición de nombre y especialidad inline
// ============================================================

function EditDoctorInline({
  doc,
  onSave,
  onCancel,
  clinicSpecialties = [],
}: {
  doc: DoctorForConfig
  onSave: (name: string, specialty: string) => void
  onCancel: () => void
  clinicSpecialties: string[]
}) {
  const [name, setName] = useState(doc.name)
  const [specialty, setSpecialty] = useState(doc.specialty ?? '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await updateDoctor(doc.id, { name: name.trim(), specialty: specialty.trim() })
      if (result.ok) {
        onSave(name.trim(), specialty.trim())
      } else {
        setError(result.error ?? 'Error')
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onCancel()
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="mb-3" onKeyDown={handleKeyDown}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Nombre</label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Especialidad</label>
          <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="input-field w-full">
            <option value="">Seleccionar...</option>
            {getSpecialtyOptions(clinicSpecialties).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={isPending}
          className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? 'Guardando...' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5"
        >
          Cancelar
        </button>
        <span className="text-xs text-slate-400 ml-auto">Enter para guardar · Esc para cancelar</span>
      </div>
    </div>
  )
}

// ============================================================
// DeleteConfirmation — Confirmación de eliminación
// ============================================================

function DeleteConfirmation({
  doctorId,
  doctorName,
  onConfirm,
  onCancel,
}: {
  doctorId: string
  doctorName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDoctor(doctorId)
      if (result.ok) {
        onConfirm()
      } else {
        setError(result.error ?? 'Error eliminando')
      }
    })
  }

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3">
      {error ? (
        <div>
          <p className="text-red-700 text-sm">{error}</p>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-red-600 hover:text-red-800 mt-2 font-medium"
          >
            Cerrar
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-red-800 text-sm">
            ¿Eliminar a <strong>{doctorName}</strong>? Esta acción no se puede deshacer.
          </p>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? 'Eliminando...' : 'Sí, eliminar'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-red-600 hover:text-red-800 px-2 py-1.5"
            >
              No
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// DoctorScheduleEditor — Editor de horarios por día con multi-bloque
// Lee y escribe doctors.working_hours en formato { active, blocks: [{start,end}] }
// ============================================================

const DAY_LABEL_LONG: Record<keyof WorkingHours, string> = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo',
}

function DoctorScheduleEditor({
  doctorId,
  initialWorkingHours,
  onSaved,
}: {
  doctorId: string
  initialWorkingHours: WorkingHours | null
  onSaved: (wh: WorkingHours) => void
}) {
  // Estado local: hidratamos desde initialWorkingHours (normalizado)
  const initial = normalizeWorkingHours(initialWorkingHours)
  // Si el doctor no tiene horario configurado, default razonable: L-V 08:00-17:00
  const isEmpty = WORKING_HOURS_DAY_KEYS.every((k) => initial[k].blocks.length === 0)
  const seed: NormalizedWorkingHours = isEmpty
    ? {
        monday:    { active: true,  blocks: [{ start: '08:00', end: '17:00' }] },
        tuesday:   { active: true,  blocks: [{ start: '08:00', end: '17:00' }] },
        wednesday: { active: true,  blocks: [{ start: '08:00', end: '17:00' }] },
        thursday:  { active: true,  blocks: [{ start: '08:00', end: '17:00' }] },
        friday:    { active: true,  blocks: [{ start: '08:00', end: '17:00' }] },
        saturday:  { active: false, blocks: [] },
        sunday:    { active: false, blocks: [] },
      }
    : initial

  const [hours, setHours] = useState<NormalizedWorkingHours>(seed)
  const [errors, setErrors] = useState<Partial<Record<keyof WorkingHours, string>>>({})
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  function setDay(key: keyof WorkingHours, updater: (prev: { active: boolean; blocks: WorkingBlock[] }) => { active: boolean; blocks: WorkingBlock[] }) {
    setHours((prev) => ({ ...prev, [key]: updater(prev[key]) }))
    setSaved(false)
  }

  function toggleDayActive(key: keyof WorkingHours) {
    setDay(key, (prev) => {
      if (prev.active) {
        // Desactivar (mantener blocks por si reactiva)
        return { ...prev, active: false }
      }
      // Activar — si no tiene blocks, agregar un default
      return {
        active: true,
        blocks: prev.blocks.length > 0 ? prev.blocks : [defaultBlock()],
      }
    })
  }

  function addBlock(key: keyof WorkingHours) {
    setDay(key, (prev) => ({ ...prev, blocks: [...prev.blocks, defaultBlock()] }))
  }

  function removeBlock(key: keyof WorkingHours, idx: number) {
    setDay(key, (prev) => {
      const next = prev.blocks.filter((_, i) => i !== idx)
      // Si se queda sin bloques y el día estaba activo → desactivarlo
      return { active: next.length === 0 ? false : prev.active, blocks: next }
    })
  }

  function updateBlock(key: keyof WorkingHours, idx: number, field: 'start' | 'end', value: string) {
    setDay(key, (prev) => ({
      ...prev,
      blocks: prev.blocks.map((b, i) => (i === idx ? { ...b, [field]: value } : b)),
    }))
  }

  function handleSave() {
    // Validar todos los días activos
    const newErrors: Partial<Record<keyof WorkingHours, string>> = {}
    for (const key of WORKING_HOURS_DAY_KEYS) {
      const day = hours[key]
      if (!day.active) continue
      if (day.blocks.length === 0) {
        newErrors[key] = 'Día activo requiere al menos un bloque'
        continue
      }
      const err = validateBlocks(day.blocks)
      if (err) newErrors[key] = err
    }
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) {
      setGlobalError('Corrige los errores antes de guardar')
      return
    }

    setGlobalError(null)
    startTransition(async () => {
      // Convertir a formato WorkingHours (con blocks)
      const payload: WorkingHours = {} as WorkingHours
      for (const key of WORKING_HOURS_DAY_KEYS) {
        payload[key] = {
          active: hours[key].active,
          blocks: hours[key].blocks.map((b) => ({ start: b.start, end: b.end })),
        }
      }
      const result = await updateDoctorWorkingHours(doctorId, payload)
      if (result.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
        onSaved(payload)
      } else {
        setGlobalError(result.error ?? 'Error guardando horario')
      }
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          Horario por día
        </label>
        <p className="text-[10px] text-slate-400">
          Soporta horarios partidos (ej. 8:30-11:45 y 13:15-16:15)
        </p>
      </div>
      <div className="space-y-2 border border-slate-100 rounded-lg p-3">
        {WORKING_HOURS_DAY_KEYS.map((key) => {
          const day = hours[key]
          const err = errors[key]
          return (
            <div key={key} className="flex items-start gap-3">
              {/* Toggle día */}
              <button
                type="button"
                onClick={() => toggleDayActive(key)}
                className={`mt-1 w-20 shrink-0 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  day.active
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                }`}
              >
                {DAY_LABEL_LONG[key].slice(0, 3)}
              </button>

              {/* Bloques o "Cerrado" */}
              <div className="flex-1 min-w-0">
                {!day.active ? (
                  <p className="text-xs text-slate-400 mt-1.5">Cerrado</p>
                ) : (
                  <div className="space-y-1.5">
                    {day.blocks.map((b, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={b.start}
                          onChange={(e) => updateBlock(key, i, 'start', e.target.value)}
                          className="input-field py-1 px-2 text-xs w-24"
                        />
                        <span className="text-xs text-slate-400">a</span>
                        <input
                          type="time"
                          value={b.end}
                          onChange={(e) => updateBlock(key, i, 'end', e.target.value)}
                          className="input-field py-1 px-2 text-xs w-24"
                        />
                        <button
                          type="button"
                          onClick={() => removeBlock(key, i)}
                          className="text-slate-300 hover:text-red-500 text-base leading-none px-1"
                          title="Eliminar bloque"
                          aria-label="Eliminar bloque"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addBlock(key)}
                      className="text-[11px] text-blue-700 hover:text-blue-800 font-medium"
                    >
                      + Agregar bloque
                    </button>
                  </div>
                )}
                {err && <p className="text-[10px] text-red-600 mt-1">{err}</p>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
        >
          {isPending ? 'Guardando...' : 'Guardar horario'}
        </button>
        {saved && <span className="text-xs text-emerald-600 font-medium">Guardado</span>}
        {globalError && <span className="text-xs text-red-600">{globalError}</span>}
      </div>
    </div>
  )
}

// ============================================================
// ImportIsaludModal — Modal para importar productos de iSalud
// para un doctor específico (sin selector de médico).
// ============================================================

function ImportIsaludModal({
  doctorId,
  doctorName,
  onClose,
  onImported,
}: {
  doctorId: string
  doctorName: string
  onClose: () => void
  onImported: () => void | Promise<void>
}) {
  type Step = 'loading' | 'scraping' | 'selection' | 'confirming' | 'done' | 'error'
  const [step, setStep] = useState<Step>('loading')
  const [data, setData] = useState<StagingDataResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, { selected: boolean; nombre: string; duracion: number; precio: number; epsName: string }>>({})
  const [onlyAgendable, setOnlyAgendable] = useState(false)
  const [confirmResult, setConfirmResult] = useState<{ created: number; skipped: number } | null>(null)

  // Bloquear scroll del body
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Inicial: chequear si ya hay staging; si no, ejecutar scraping con fire-and-poll
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        // 1) Verificar si ya hay staging cargado
        const existing = await getStagingProducts()
        if (cancelled) return
        if (existing.totalProducts > 0) {
          setData(existing)
          setSelection(buildSelection(existing))
          setStep('selection')
          return
        }
        // 2) Si no hay, disparar el scraping en background (NO await — evita timeout del browser)
        setStep('scraping')
        fetch('/api/isalud/convenios', { method: 'POST' }).catch(() => {})

        // 3) Polling: cada 5s verificar staging. Para cuando el conteo se
        //    estabiliza (mismo número 3 polls seguidos = scraping terminó).
        const poll = async () => {
          let lastCount = 0
          let stableRuns = 0
          for (let attempt = 0; attempt < 36; attempt++) { // max 3 min (36 × 5s)
            if (cancelled) return
            await new Promise((r) => setTimeout(r, 5000))
            if (cancelled) return
            try {
              const check = await getStagingProducts()
              if (cancelled) return
              const currentCount = check.totalProducts

              if (currentCount > 0 && currentCount === lastCount) {
                stableRuns++
              } else {
                stableRuns = 0
              }
              lastCount = currentCount

              // Estabilizado: mismo conteo 3 veces seguidas (15s sin cambios) con datos
              if (stableRuns >= 2 && currentCount > 0) {
                setData(check)
                setSelection(buildSelection(check))
                setStep('selection')
                return
              }
            } catch { /* sigue intentando */ }
          }
          // Timeout tras 3 min — mostrar lo que haya o error
          if (!cancelled) {
            try {
              const final = await getStagingProducts()
              if (final.totalProducts > 0) {
                setData(final)
                setSelection(buildSelection(final))
                setStep('selection')
                return
              }
            } catch { /* */ }
            setError('La importación está tomando más de lo esperado. Cierra e intenta de nuevo.')
            setStep('error')
          }
        }
        await poll()
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error inesperado')
        setStep('error')
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  function buildSelection(d: StagingDataResponse) {
    const sel: Record<string, { selected: boolean; nombre: string; duracion: number; precio: number; epsName: string }> = {}
    for (const g of d.groups) {
      for (const p of g.productos) {
        sel[p.id] = {
          selected: false,
          nombre: p.producto_nombre,
          duracion: p.duracion_minutos ?? 30,
          precio: p.tarifa,
          epsName: g.convenio_nombre,
        }
      }
    }
    return sel
  }

  function toggle(id: string) {
    setSelection((prev) => ({ ...prev, [id]: { ...prev[id], selected: !prev[id].selected } }))
  }

  function update(id: string, field: 'nombre' | 'duracion' | 'precio', value: string | number) {
    setSelection((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  function selectAllInGroup(ids: string[], select: boolean) {
    setSelection((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = { ...next[id], selected: select }
      return next
    })
  }

  async function handleConfirm() {
    setError(null)
    const items = Object.entries(selection)
      .filter(([, s]) => s.selected)
      .map(([productoId, s]) => ({
        productoId,
        nombre: s.nombre.trim(),
        duracion: s.duracion,
        precio: s.precio,
        epsName: s.epsName || null,
      }))
    if (items.length === 0) {
      setError('Selecciona al menos un producto')
      return
    }
    setStep('confirming')
    const result = await confirmImportForDoctor(doctorId, items)
    if (result.ok) {
      setConfirmResult({ created: result.created ?? 0, skipped: result.skipped ?? 0 })
      setStep('done')
      await onImported()
    } else {
      setError(result.error ?? 'Error al importar')
      setStep('selection')
    }
  }

  async function handleCancel() {
    await cancelImport()
    onClose()
  }

  const selectedCount = Object.values(selection).filter((s) => s.selected).length

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Importar desde iSalud</h2>
            <p className="text-xs text-slate-500 mt-0.5">Para {doctorName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {(step === 'loading' || step === 'scraping') && (
            <div className="py-16 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-[#028090]/10 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-[#028090] animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
              <p className="text-sm text-slate-700 font-medium">
                {step === 'loading' ? 'Cargando productos...' : 'Trayendo convenios desde iSalud...'}
              </p>
              <p className="text-xs text-slate-400 mt-2">
                {step === 'scraping' ? 'Puede tomar 1-2 minutos. No cierres esta ventana.' : ''}
              </p>
            </div>
          )}

          {step === 'error' && (
            <div className="py-12 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">⚠️</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900">No se pudo importar</h3>
              <p className="text-xs text-slate-500 mt-2 max-w-sm mx-auto break-words">{error}</p>
              <button
                onClick={onClose}
                className="mt-5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg transition-colors"
              >
                Cerrar
              </button>
            </div>
          )}

          {step === 'done' && confirmResult && (
            <div className="py-12 px-6 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-slate-900">¡Listo!</h3>
              <div className="mt-4 inline-block bg-slate-50 rounded-lg px-5 py-3 text-left space-y-1">
                <p className="text-sm"><strong>{confirmResult.created}</strong> tipos de consulta creados</p>
                {confirmResult.skipped > 0 && (
                  <p className="text-xs text-slate-400">{confirmResult.skipped} omitidos (ya existían)</p>
                )}
              </div>
              <div className="mt-5">
                <button onClick={onClose} className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium py-2 px-5 rounded-lg transition-colors">
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {(step === 'selection' || step === 'confirming') && data && (
            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyAgendable}
                    onChange={(e) => setOnlyAgendable(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Solo agendables web
                </label>
                <p className="text-xs text-slate-500">
                  <strong className="text-slate-900">{selectedCount}</strong> seleccionados de <strong>{data.totalProducts}</strong>
                </p>
              </div>

              {data.groups.map((group) => {
                const visible = onlyAgendable ? group.productos.filter((p) => p.agendable_web) : group.productos
                if (visible.length === 0) return null
                const allSel = visible.every((p) => selection[p.id]?.selected)
                return (
                  <div key={`${group.convenio_nit}|${group.convenio_nombre}`} className="border border-slate-100 rounded-lg overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">{group.convenio_nombre}</p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {group.convenio_nit && <>NIT: {group.convenio_nit} · </>}
                          {visible.length} productos
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => selectAllInGroup(visible.map((p) => p.id), !allSel)}
                        className="text-[11px] text-blue-700 hover:text-blue-800 font-medium shrink-0"
                      >
                        {allSel ? 'Deseleccionar' : 'Seleccionar todos'}
                      </button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {visible.map((p) => {
                        const s = selection[p.id]
                        if (!s) return null
                        return (
                          <div key={p.id} className="px-4 py-2 grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-1 flex justify-center">
                              <input
                                type="checkbox"
                                checked={s.selected}
                                onChange={() => toggle(p.id)}
                                className="rounded border-slate-300"
                              />
                            </div>
                            <div className="col-span-6">
                              <input
                                type="text"
                                value={s.nombre}
                                onChange={(e) => update(p.id, 'nombre', e.target.value)}
                                disabled={!s.selected}
                                className="input-field text-xs py-1 w-full"
                              />
                              {p.agendable_web && (
                                <span className="inline-block mt-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5">
                                  Agendable web
                                </span>
                              )}
                            </div>
                            <div className="col-span-2">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={5}
                                  max={240}
                                  value={s.duracion}
                                  onChange={(e) => update(p.id, 'duracion', Number(e.target.value) || 30)}
                                  disabled={!s.selected}
                                  className="input-field text-xs py-1 w-14"
                                />
                                <span className="text-[10px] text-slate-400">min</span>
                              </div>
                            </div>
                            <div className="col-span-3">
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-slate-400">$</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={s.precio}
                                  onChange={(e) => update(p.id, 'precio', Number(e.target.value) || 0)}
                                  disabled={!s.selected}
                                  className="input-field text-xs py-1 w-full"
                                />
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {(step === 'selection' || step === 'confirming') && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
            {error && <span className="text-xs text-red-600 truncate flex-1">{error}</span>}
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={handleCancel}
                disabled={step === 'confirming'}
                className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={selectedCount === 0 || step === 'confirming'}
                className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {step === 'confirming' ? 'Importando...' : `Importar seleccionados${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
