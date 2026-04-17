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

        {/* Precio de consulta y meta diaria removidos — se configuran por tipo de consulta en cada médico */}
      </div>

      {/* --- Reglas de agendamiento --- */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Reglas de agendamiento</h3>
        <p className="text-xs text-slate-400 mb-5">
          Controla con cuánta anticipación los pacientes pueden agendar citas por WhatsApp.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {/* Anticipación mínima */}
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
              Anticipación mínima para agendar
            </label>
            <select
              value={
                [0, 24, 48, 72, 120, 168].includes(data.min_booking_advance_hours)
                  ? String(data.min_booking_advance_hours)
                  : 'custom'
              }
              onChange={(e) => {
                const val = e.target.value
                if (val !== 'custom') {
                  update('min_booking_advance_hours', Number(val))
                }
              }}
              className="input-field w-full"
            >
              <option value="0">Mismo día (0h)</option>
              <option value="24">24 horas (1 día)</option>
              <option value="48">48 horas (2 días)</option>
              <option value="72">72 horas (3 días)</option>
              <option value="120">5 días</option>
              <option value="168">7 días</option>
              <option value="custom">Personalizado</option>
            </select>
            {![0, 24, 48, 72, 120, 168].includes(data.min_booking_advance_hours) && (
              <div className="mt-2">
                <input
                  type="number"
                  min={0}
                  max={720}
                  value={data.min_booking_advance_hours}
                  onChange={(e) => update('min_booking_advance_hours', Math.max(0, Number(e.target.value) || 0))}
                  className="input-field w-full"
                  placeholder="Horas de anticipación"
                />
                <p className="text-xs text-slate-400 mt-1">Horas de anticipación mínima</p>
              </div>
            )}
          </div>

          {/* Máximo de anticipación */}
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
              Máximo de anticipación
            </label>
            <select
              value={data.max_booking_advance_days}
              onChange={(e) => update('max_booking_advance_days', Number(e.target.value))}
              className="input-field w-full"
            >
              <option value={15}>15 días</option>
              <option value={30}>30 días</option>
              <option value={60}>60 días</option>
              <option value={90}>90 días</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Los pacientes pueden agendar hasta {data.max_booking_advance_days} días en el futuro
            </p>
          </div>
        </div>
      </div>

      {/* --- Consultas virtuales --- */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Consultas virtuales</h3>
        <p className="text-xs text-slate-400 mb-5">
          Configura la plataforma para tus consultas por videollamada. El agente enviará el enlace al paciente.
        </p>

        <div className="space-y-4">
          {/* Toggle habilitar */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Habilitar consultas virtuales</p>
              <p className="text-xs text-slate-400">Permite agendar citas virtuales por WhatsApp</p>
            </div>
            <button
              type="button"
              onClick={() => update('virtual_config', { ...data.virtual_config, enabled: !data.virtual_config.enabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                data.virtual_config.enabled ? 'bg-blue-700' : 'bg-slate-200'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                data.virtual_config.enabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {data.virtual_config.enabled && (
            <>
              {/* Plataforma */}
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                  Plataforma de videollamada
                </label>
                <select
                  value={data.virtual_config.platform}
                  onChange={(e) => update('virtual_config', { ...data.virtual_config, platform: e.target.value as 'google_meet' | 'zoom' | 'teams' | 'custom' | 'isalud' })}
                  className="input-field w-full"
                >
                  <option value="google_meet">Google Meet</option>
                  <option value="zoom">Zoom</option>
                  <option value="teams">Microsoft Teams</option>
                  <option value="custom">Link propio</option>
                  <option value="isalud">iSalud (envío manual)</option>
                </select>
              </div>

              {/* URL base (para zoom, teams, custom) */}
              {['zoom', 'teams', 'custom'].includes(data.virtual_config.platform) && (
                <div>
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                    {data.virtual_config.platform === 'custom' ? 'Link fijo de videollamada' : `URL base de ${data.virtual_config.platform === 'zoom' ? 'Zoom' : 'Teams'}`}
                  </label>
                  <input
                    type="url"
                    value={data.virtual_config.base_url ?? ''}
                    onChange={(e) => update('virtual_config', { ...data.virtual_config, base_url: e.target.value || null })}
                    placeholder={
                      data.virtual_config.platform === 'zoom' ? 'https://zoom.us/j/1234567890'
                      : data.virtual_config.platform === 'teams' ? 'https://teams.microsoft.com/l/meetup-join/...'
                      : 'https://...'
                    }
                    className="input-field w-full"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    {data.virtual_config.platform === 'custom'
                      ? 'Este link se enviará a todos los pacientes con cita virtual.'
                      : 'Se enviará este link a los pacientes antes de su cita.'}
                  </p>
                </div>
              )}

              {data.virtual_config.platform === 'google_meet' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-blue-700">
                    Se generará un enlace de Google Meet por cada cita virtual. El paciente recibirá el link 30 minutos antes.
                  </p>
                </div>
              )}

              {data.virtual_config.platform === 'isalud' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-amber-700">
                    El link de iSalud debe enviarse manualmente desde la plataforma. El agente le informará al paciente que recibirá el enlace.
                  </p>
                </div>
              )}

              {/* Instrucciones */}
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
                  Instrucciones para el paciente
                  <span className="text-slate-400 normal-case tracking-normal ml-1">(opcional)</span>
                </label>
                <textarea
                  value={data.virtual_config.instructions ?? ''}
                  onChange={(e) => update('virtual_config', { ...data.virtual_config, instructions: e.target.value || null })}
                  rows={2}
                  placeholder="Ingresa al enlace 5 minutos antes de tu cita. Asegúrate de tener buena conexión a internet."
                  className="input-field w-full resize-none"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* --- Alertas de escalamiento --- */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Alertas de escalamiento</h3>
        <p className="text-xs text-slate-400 mb-5">
          Cuando un paciente necesite atención urgente, enviaremos un WhatsApp a este número.
        </p>

        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1 block">
            Número para alertas de escalamiento
            <span className="text-slate-400 normal-case tracking-normal ml-1">(opcional)</span>
          </label>
          <input
            type="tel"
            value={data.escalation_contact_phone}
            onChange={(e) => update('escalation_contact_phone', e.target.value)}
            placeholder="+57 3XX XXX XXXX"
            className="input-field w-full"
          />
          <p className="text-xs text-slate-400 mt-1">
            Este número recibirá un WhatsApp cuando un paciente necesite atención urgente
          </p>
        </div>
      </div>

      {/* --- Política de cancelación --- */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Política de cancelación</h3>
        <p className="text-xs text-slate-400 mb-4">
          Si configuras una política, el agente la informará al paciente antes de cancelar una cita.
        </p>
        <textarea
          value={data.cancellation_policy}
          onChange={(e) => update('cancellation_policy', e.target.value)}
          placeholder="Ej: Las cancelaciones deben realizarse con mínimo 24 horas de anticipación. Cancelaciones de último momento pueden generar un cobro."
          className="input-field w-full"
          rows={3}
        />
      </div>

      {/* --- Mensaje de bienvenida --- */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Mensaje de bienvenida</h3>
        <p className="text-xs text-slate-400 mb-4">
          Este es el primer mensaje que reciben tus pacientes al escribirte por WhatsApp. Si lo dejas vacío, el agente genera uno automáticamente.
        </p>
        <textarea
          value={data.welcome_message}
          onChange={(e) => update('welcome_message', e.target.value)}
          placeholder="Ej: ¡Hola! Soy el asistente virtual de Algia Clínica. Estoy aquí para ayudarte a agendar tu cita. ¿Con qué especialidad necesitas atención?"
          className="input-field w-full"
          rows={3}
        />
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

      {/* Sticky save bar — siempre visible al fondo de la pantalla */}
      <div className="sticky bottom-0 -mx-5 px-5 py-3 bg-white/95 backdrop-blur border-t border-slate-200 flex items-center gap-3 z-10">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="btn-primary"
        >
          {isPending ? 'Guardando...' : 'Guardar configuración'}
        </button>
        {saved && <span className="text-sm text-emerald-600 font-medium">Guardado ✓</span>}
        {error && <span className="text-sm text-red-600 font-medium">{error}</span>}
      </div>
    </div>
  )
}
