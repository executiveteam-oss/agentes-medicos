'use client'

// ============================================================
// Formulario completo de configuración del consultorio (Tab 1)
// ============================================================

import { useState, useTransition, type KeyboardEvent } from 'react'
import { saveClinicSettings } from '@/app/actions/clinic'
import type { ClinicSettingsData } from '@/app/actions/clinic'

interface Props {
  initialData: ClinicSettingsData
}

// --- Specialty tag input ---

function SpecialtyInput({
  values,
  onChange,
}: {
  values: string[]
  onChange: (v: string[]) => void
}) {
  const [input, setInput] = useState('')

  function addTag() {
    const tag = input.trim()
    if (tag && !values.includes(tag)) {
      onChange([...values, tag])
    }
    setInput('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
    if (e.key === 'Backspace' && !input && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== tag))}
              className="text-blue-400 hover:text-blue-700 ml-0.5"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder="Escribe y presiona Enter para agregar"
        className="input-field w-full"
      />
    </div>
  )
}

// --- Main form ---

export function ClinicSettingsForm({ initialData }: Props) {
  const [data, setData] = useState<ClinicSettingsData>(initialData)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof ClinicSettingsData>(key: K, value: ClinicSettingsData[K]) {
    setData((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleSave() {
    setSaved(false)
    setError(null)
    startTransition(async () => {
      const result = await saveClinicSettings(data)
      if (result.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(result.error ?? 'Error desconocido')
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* --- Información general --- */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Información general</h3>
        <p className="text-xs text-slate-400 mb-5">
          Datos principales de tu consultorio. El nombre y teléfono se usan en el agente de WhatsApp.
        </p>

        <div className="space-y-4">
          {/* Nombre */}
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
              Nombre del consultorio *
            </label>
            <input
              type="text"
              value={data.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Consultorio Dra. López"
              className="input-field w-full"
            />
          </div>

          {/* Especialidades */}
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
              Especialidades
            </label>
            <SpecialtyInput
              values={data.specialty}
              onChange={(v) => update('specialty', v)}
            />
          </div>

          {/* Teléfono + Email */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Teléfono de contacto
              </label>
              <input
                type="tel"
                value={data.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="3XX XXX XXXX"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Email de contacto
                <span className="text-slate-400 normal-case tracking-normal ml-1">(opcional)</span>
              </label>
              <input
                type="email"
                value={data.contact_email}
                onChange={(e) => update('contact_email', e.target.value)}
                placeholder="contacto@consultorio.com"
                className="input-field w-full"
              />
            </div>
          </div>

          {/* Website + Logo */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Sitio web
                <span className="text-slate-400 normal-case tracking-normal ml-1">(opcional)</span>
              </label>
              <input
                type="url"
                value={data.website}
                onChange={(e) => update('website', e.target.value)}
                placeholder="https://www.miconsultorio.com"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                URL del logo
                <span className="text-slate-400 normal-case tracking-normal ml-1">(opcional)</span>
              </label>
              <input
                type="url"
                value={data.logo_url}
                onChange={(e) => update('logo_url', e.target.value)}
                placeholder="https://..."
                className="input-field w-full"
              />
            </div>
          </div>
        </div>
      </div>

      {/* --- Consulta --- */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Consulta</h3>
        <p className="text-xs text-slate-400 mb-5">
          El agente usa el precio para responder preguntas de pacientes.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
              Precio de consulta (COP)
            </label>
            <input
              type="number"
              value={data.consultation_price ?? ''}
              onChange={(e) => update('consultation_price', e.target.value ? Number(e.target.value) : null)}
              placeholder="80000"
              className="input-field w-full"
            />
            {data.consultation_price != null && data.consultation_price > 0 && (
              <p className="text-xs text-slate-400 mt-1">
                ${data.consultation_price.toLocaleString('es-CO')} COP
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
              Meta diaria de citas
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={data.daily_goal_appointments}
              onChange={(e) => update('daily_goal_appointments', Number(e.target.value) || 10)}
              className="input-field w-full"
            />
          </div>
        </div>
      </div>

      {/* --- Ubicación --- */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Ubicación</h3>
        <p className="text-xs text-slate-400 mb-5">
          Esta información aparece cuando el agente confirma citas por WhatsApp.
        </p>

        <div className="space-y-4">
          {/* Dirección */}
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
              Dirección
            </label>
            <input
              type="text"
              value={data.address}
              onChange={(e) => update('address', e.target.value)}
              placeholder="Calle 10 # 5-23"
              className="input-field w-full"
            />
          </div>

          {/* Ciudad + Departamento */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Ciudad
              </label>
              <input
                type="text"
                value={data.city}
                onChange={(e) => update('city', e.target.value)}
                placeholder="Pereira"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Departamento
              </label>
              <input
                type="text"
                value={data.department}
                onChange={(e) => update('department', e.target.value)}
                placeholder="Risaralda"
                className="input-field w-full"
              />
            </div>
          </div>

          {/* Edificio */}
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
              Edificio / Centro médico
              <span className="text-slate-400 normal-case tracking-normal ml-1">(opcional)</span>
            </label>
            <input
              type="text"
              value={data.building}
              onChange={(e) => update('building', e.target.value)}
              placeholder="Torre Médica Los Alpes"
              className="input-field w-full"
            />
          </div>

          {/* Piso + Consultorio */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Piso
                <span className="text-slate-400 normal-case tracking-normal ml-1">(opcional)</span>
              </label>
              <input
                type="text"
                value={data.floor}
                onChange={(e) => update('floor', e.target.value)}
                placeholder="Piso 3"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                Consultorio / Oficina
                <span className="text-slate-400 normal-case tracking-normal ml-1">(opcional)</span>
              </label>
              <input
                type="text"
                value={data.office}
                onChange={(e) => update('office', e.target.value)}
                placeholder="Consultorio 302"
                className="input-field w-full"
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        {(data.address || data.building) && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Vista previa en WhatsApp</p>
            <div className="bg-slate-50 rounded-lg px-4 py-3">
              <p className="text-sm text-slate-700">
                {'📍 '}
                {data.building && `${data.building}`}
                {data.floor && `, ${data.floor}`}
                {data.office && `, ${data.office}`}
                {data.building && data.address && ', '}
                {data.address}
                {data.city && `, ${data.city}`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Save */}
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
