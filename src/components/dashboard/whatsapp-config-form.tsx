'use client'

// ============================================================
// WhatsAppConfigForm — Configuración del agente + gestión de doctores
// Secciones: Horario, Duración citas, Keywords, Doctores (CRUD completo)
// ============================================================

import { useState, useTransition, useRef, useEffect } from 'react'
import { saveWhatsAppConfig } from '@/app/actions/whatsapp'
import {
  createDoctor,
  updateDoctor,
  toggleDoctorActive,
  deleteDoctor,
} from '@/app/actions/doctors'
import type { WhatsAppConfig, WhatsAppDoctorConfig } from '@/types/database'
import type { DoctorForConfig } from '@/app/actions/whatsapp'

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
}

export function WhatsAppConfigForm({ initialConfig, doctors: initialDoctors }: Props) {
  const [config, setConfig] = useState<WhatsAppConfig>(initialConfig)
  const [doctors, setDoctors] = useState<DoctorForConfig[]>(initialDoctors)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const keywordRef = useRef<HTMLInputElement>(null)

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
                    // Update local + whatsapp config + DB
                    setDoctors((prev) =>
                      prev.map((d) => (d.id === doc.id ? { ...d, is_active: active } : d))
                    )
                    updateDoctorConfig(doc.id, { active })
                    toggleDoctorActive(doc.id, active)
                    showToast(active ? `${doc.name} activado` : `${doc.name} desactivado`)
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
}) {
  return (
    <div className={`border rounded-xl p-4 transition-colors ${isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50/80'}`}>
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
              <p className={`text-sm font-medium truncate ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                {doc.name}
              </p>
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

      {/* Delete confirmation */}
      {isConfirmingDelete && (
        <DeleteConfirmation
          doctorId={doc.id}
          doctorName={doc.name}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}

      {/* Schedule (only when active and not editing) */}
      {isActive && !isEditing && !isConfirmingDelete && (
        <div className="space-y-3">
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
        </div>
      )}
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
