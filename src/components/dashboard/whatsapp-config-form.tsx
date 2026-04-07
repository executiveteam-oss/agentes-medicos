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
} from '@/app/actions/doctors'
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

interface Props {
  initialConfig: WhatsAppConfig
  doctors: DoctorForConfig[]
  initialVacationMessage?: string | null
}

export function WhatsAppConfigForm({ initialConfig, doctors: initialDoctors, initialVacationMessage }: Props) {
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
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Doctores</h3>
            <p className="text-xs text-slate-400 mt-0.5">Gestiona médicos y su horario de citas</p>
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
              const docDays = dc?.days ?? config.schedule.days
              const docStart = dc?.start ?? config.schedule.start
              const docEnd = dc?.end ?? config.schedule.end
              const docDuration = dc?.duration ?? config.appointment.default_duration

              return (
                <DoctorCard
                  key={doc.id}
                  doc={doc}
                  isActive={isActive}
                  isEditing={editingDoctorId === doc.id}
                  isConfirmingDelete={confirmDeleteId === doc.id}
                  docDays={docDays}
                  docStart={docStart}
                  docEnd={docEnd}
                  docDuration={docDuration}
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
                  onToggleDay={(day) => toggleDoctorDay(doc.id, day)}
                  onChangeStart={(v) => updateDoctorConfig(doc.id, { start: v })}
                  onChangeEnd={(v) => updateDoctorConfig(doc.id, { end: v })}
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
}: {
  onCreated: (doc: DoctorForConfig) => void
  onCancel: () => void
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
          <input
            name="specialty"
            type="text"
            placeholder="Medicina general"
            className="input-field w-full"
          />
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
  docDays,
  docStart,
  docEnd,
  docDuration,
  onToggleActive,
  onAgendaChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onToggleDay,
  onChangeStart,
  onChangeEnd,
  onChangeDuration,
  onScheduleTypeChange,
}: {
  doc: DoctorForConfig
  isActive: boolean
  isEditing: boolean
  isConfirmingDelete: boolean
  docDays: number[]
  docStart: string
  docEnd: string
  docDuration: number
  onToggleActive: (active: boolean) => void
  onAgendaChange: (closed: boolean, reason?: string | null, until?: string | null) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (name: string, specialty: string) => void
  onStartDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onToggleDay: (day: number) => void
  onChangeStart: (v: string) => void
  onChangeEnd: (v: string) => void
  onChangeDuration: (v: number) => void
  onScheduleTypeChange: (type: 'fixed' | 'manual', message: string | null) => void
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
              <p className="text-xs text-slate-400">{doc.specialty ?? 'General'}</p>
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

          {/* Fixed schedule: Days / Hours / Duration */}
          {scheduleType === 'fixed' && (
            <>
              {/* Days */}
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                  Días disponibles
                </label>
                <div className="flex gap-1.5">
                  {DAY_LABELS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => onToggleDay(d.value)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                        docDays.includes(d.value)
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time + Duration */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Inicio</label>
                  <input
                    type="time"
                    value={docStart}
                    onChange={(e) => onChangeStart(e.target.value)}
                    className="input-field mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Fin</label>
                  <input
                    type="time"
                    value={docEnd}
                    onChange={(e) => onChangeEnd(e.target.value)}
                    className="input-field mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Duración</label>
                  <select
                    value={docDuration}
                    onChange={(e) => onChangeDuration(Number(e.target.value))}
                    className="input-field mt-1 w-full"
                  >
                    {DURATION_OPTIONS.map((m) => (
                      <option key={m} value={m}>{m} min</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Tipos de consulta */}
          <ConsultationTypesSection doctorId={doc.id} doctorName={doc.name} />
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

function ConsultationTypesSection({ doctorId, doctorName }: { doctorId: string; doctorName: string }) {
  const [types, setTypes] = useState<ConsultationType[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="text-xs text-blue-700 hover:text-blue-800 font-medium py-1.5"
            >
              + Agregar tipo de consulta
            </button>
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
  onSave: (input: { name: string; duration_minutes: number; requires_preparation: boolean; preparation_instructions: string | null; price: number | null; is_active: boolean; bookable_via_whatsapp: boolean; requires_documents: boolean; required_documents_description: string | null; modality: 'presencial' | 'virtual' | 'ambas' }) => Promise<{ ok: boolean; error?: string }>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
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
}: {
  doc: DoctorForConfig
  onSave: (name: string, specialty: string) => void
  onCancel: () => void
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
          <input
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            className="input-field w-full"
          />
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
