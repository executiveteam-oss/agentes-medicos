'use client'

// ============================================================
// Página de registro — nueva clínica
// Ruta: /register
// Crea: clínica + 5 roles predefinidos + usuario Admin
// ============================================================

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { registerAction } from '@/app/actions/auth'

const ESPECIALIDADES = [
  'Medicina General',
  'Odontología',
  'Ortodoncia',
  'Implantología',
  'Endodoncia',
  'Periodoncia',
  'Cirugía Oral',
  'Pediatría',
  'Ginecología',
  'Dermatología',
  'Oftalmología',
  'Psicología',
  'Nutrición',
  'Fisioterapia',
  'Cardiología',
  'Neurología',
  'Ortopedia',
  'Otorrinolaringología',
  'Urología',
  'Optometría',
]

const STEPS = [
  { label: 'Consultorio', num: 1 },
  { label: 'Tu cuenta', num: 2 },
]

export default function RegisterPage() {
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [selectedSpecs, setSelectedSpecs] = useState<string[]>([])
  const [customSpec, setCustomSpec] = useState('')
  const [showSpecs, setShowSpecs] = useState(false)
  const specsRef = useRef<HTMLDivElement>(null)

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (specsRef.current && !specsRef.current.contains(e.target as Node)) {
        setShowSpecs(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleSpec(spec: string) {
    setSelectedSpecs((prev) =>
      prev.includes(spec) ? prev.filter((s) => s !== spec) : [...prev, spec]
    )
  }

  function addCustomSpec() {
    const trimmed = customSpec.trim()
    if (trimmed && !selectedSpecs.includes(trimmed)) {
      setSelectedSpecs((prev) => [...prev, trimmed])
      setCustomSpec('')
    }
  }

  function removeSpec(spec: string) {
    setSelectedSpecs((prev) => prev.filter((s) => s !== spec))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.delete('specialty')
    selectedSpecs.forEach((s) => formData.append('specialty', s))

    const result = await registerAction(formData)

    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="card p-8">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-3 mb-8">
        {STEPS.map((s) => (
          <div key={s.num} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                step >= s.num
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {s.num}
            </div>
            <span
              className={`text-sm font-medium ${
                step >= s.num ? 'text-slate-900' : 'text-slate-400'
              }`}
            >
              {s.label}
            </span>
            {s.num < STEPS.length && (
              <div className={`w-8 h-px ${step > s.num ? 'bg-blue-700' : 'bg-slate-200'}`} />
            )}
          </div>
        ))}
      </div>

      <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">Crear cuenta</h2>
      <p className="text-sm text-slate-500 mb-6">14 días gratis, sin tarjeta de crédito</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Step 1: Datos del consultorio */}
        <div className={step === 1 ? 'space-y-4' : 'hidden'}>
          <div>
            <label className="label" htmlFor="clinic_name">
              Nombre del consultorio
            </label>
            <input
              id="clinic_name"
              name="clinic_name"
              type="text"
              required
              className="input-field"
              placeholder="Consultorio Médico Dr. García"
            />
          </div>

          <div className="relative" ref={specsRef}>
            <label className="label">
              Especialidades
            </label>

            {/* Chips de especialidades seleccionadas */}
            <div
              className="w-full min-h-[42px] bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer flex flex-wrap gap-1.5 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all"
              onClick={() => setShowSpecs(!showSpecs)}
            >
              {selectedSpecs.length === 0 && (
                <span className="text-slate-400 text-sm py-0.5">Selecciona especialidades...</span>
              )}
              {selectedSpecs.map((spec) => (
                <span
                  key={spec}
                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full"
                >
                  {spec}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeSpec(spec) }}
                    className="hover:text-blue-900 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            {/* Dropdown de opciones */}
            {showSpecs && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {/* Input para agregar especialidad personalizada */}
                <div className="sticky top-0 bg-white p-2 border-b border-slate-100">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customSpec}
                      onChange={(e) => setCustomSpec(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSpec() } }}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Agregar otra..."
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); addCustomSpec() }}
                      className="bg-blue-700 hover:bg-blue-800 text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
                {ESPECIALIDADES.map((spec) => (
                  <label
                    key={spec}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSpecs.includes(spec)}
                      onChange={() => toggleSpec(spec)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-500"
                    />
                    <span className="text-slate-700">{spec}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            className="btn-primary w-full"
          >
            Continuar
          </button>
        </div>

        {/* Step 2: Datos de la cuenta */}
        <div className={step === 2 ? 'space-y-4' : 'hidden'}>
          <div>
            <label className="label" htmlFor="full_name">
              Tu nombre completo
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              className="input-field"
              placeholder="Dr. Juan García"
            />
          </div>

          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="input-field"
              placeholder="tu@consultorio.com"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="input-field"
              placeholder="Mínimo 6 caracteres"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-secondary flex-1"
            >
              Atrás
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? 'Creando...' : 'Crear cuenta'}
            </button>
          </div>

          <p className="text-xs text-slate-400 text-center">
            Al crear tu cuenta aceptas nuestros términos de servicio y política de privacidad.
          </p>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="text-blue-700 hover:text-blue-800 font-medium">
          Iniciar sesión
        </Link>
      </p>
    </div>
  )
}
