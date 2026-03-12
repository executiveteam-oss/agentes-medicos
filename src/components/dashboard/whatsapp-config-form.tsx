'use client'

// ============================================================
// WhatsAppConfigForm — Formulario de configuración del agente
// Secciones: Horario, Duración citas, Keywords, Doctores
// ============================================================

import { useState, useTransition, useRef } from 'react'
import { saveWhatsAppConfig } from '@/app/actions/whatsapp'
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

export function WhatsAppConfigForm({ initialConfig, doctors }: Props) {
  const [config, setConfig] = useState<WhatsAppConfig>(initialConfig)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keywordRef = useRef<HTMLInputElement>(null)

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
      {/* 1. Horario de atención */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Horario de atención</h3>
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

        <div className="mb-4">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">Días activos</label>
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

        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
            Mensaje fuera de horario
          </label>
          <textarea
            value={config.schedule.out_of_hours_message}
            onChange={(e) => updateSchedule('out_of_hours_message', e.target.value)}
            rows={2}
            className="input-field w-full"
          />
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

      {/* 4. Configuración por doctor */}
      {doctors.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Configuración por doctor</h3>
          <div className="space-y-4">
            {doctors.map((doc) => {
              const dc = config.doctors[doc.id]
              const isActive = dc?.active ?? doc.is_active
              const docDays = dc?.days ?? config.schedule.days
              const docStart = dc?.start ?? config.schedule.start
              const docEnd = dc?.end ?? config.schedule.end
              const docDuration = dc?.duration ?? config.appointment.default_duration

              return (
                <div key={doc.id} className="border border-slate-200 rounded-xl p-4">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{doc.name}</p>
                      <p className="text-xs text-slate-400">{doc.specialty ?? 'General'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateDoctorConfig(doc.id, { active: !isActive })}
                      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                        isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-red-50 text-red-600 border-red-200'
                      }`}
                    >
                      {isActive ? 'Activo' : 'Inactivo'}
                    </button>
                  </div>

                  {isActive && (
                    <div className="space-y-3">
                      {/* Días */}
                      <div>
                        <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                          Días disponibles
                        </label>
                        <div className="flex gap-1.5">
                          {DAY_LABELS.map((d) => (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => toggleDoctorDay(doc.id, d.value)}
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

                      {/* Horario + Duración */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Inicio</label>
                          <input
                            type="time"
                            value={docStart}
                            onChange={(e) => updateDoctorConfig(doc.id, { start: e.target.value })}
                            className="input-field mt-1 w-full"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Fin</label>
                          <input
                            type="time"
                            value={docEnd}
                            onChange={(e) => updateDoctorConfig(doc.id, { end: e.target.value })}
                            className="input-field mt-1 w-full"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Duración</label>
                          <select
                            value={docDuration}
                            onChange={(e) => updateDoctorConfig(doc.id, { duration: Number(e.target.value) })}
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
            })}
          </div>
        </div>
      )}

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
