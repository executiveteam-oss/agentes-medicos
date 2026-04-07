'use client'

// ============================================================
// Página de registro — Omuwan branded
// Ruta: /register
// Crea: clínica + 5 roles predefinidos + usuario Admin
// Lee params del configurador: ?plan=core&medicos=1&citas=150&features=agent,reminders
// ============================================================

import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
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

const PLAN_LABELS: Record<string, string> = {
  core: 'Core',
  basico: 'Core',
  pro: 'Core',
  clinica: 'Core',
}

const FEATURE_LABELS: Record<string, string> = {
  agent: 'Agente IA',
  reminders: 'Recordatorios',
  docs: 'Documentos',
  waitlist: 'Lista de espera',
  reactivation: 'Reactivación',
  dashboard: 'Dashboard',
  insights: 'Insights',
  virtual: 'Virtual',
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-400">Cargando...</div>}>
      <RegisterForm />
    </Suspense>
  )
}

function RegisterForm() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [selectedSpecs, setSelectedSpecs] = useState<string[]>([])
  const [customSpec, setCustomSpec] = useState('')
  const [showSpecs, setShowSpecs] = useState(false)
  const [specError, setSpecError] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  const [doctorRange, setDoctorRange] = useState<string>('')
  const specsRef = useRef<HTMLDivElement>(null)

  const DOCTOR_OPTIONS = [
    { range: '1', label: '1 médico', price: '$390.000/mes' },
    { range: '2-3', label: '2-3 médicos', price: '$620.000/mes' },
    { range: '4-6', label: '4-6 médicos', price: '$850.000/mes' },
    { range: '7-10', label: '7-10 médicos', price: '$1.090.000/mes' },
  ]

  // Configurator params from URL
  const cfgPlan = searchParams.get('plan')
  const cfgMedicos = searchParams.get('medicos')
  const cfgCitas = searchParams.get('citas')
  const cfgFeatures = searchParams.get('features')
  const hasConfig = !!(cfgPlan || cfgMedicos || cfgCitas || cfgFeatures)

  // Save config to sessionStorage so it survives form submission
  useEffect(() => {
    if (hasConfig) {
      const config = {
        plan: cfgPlan,
        medicos: cfgMedicos,
        citas: cfgCitas,
        features: cfgFeatures,
      }
      sessionStorage.setItem('omuwan_config', JSON.stringify(config))
    }
  }, [hasConfig, cfgPlan, cfgMedicos, cfgCitas, cfgFeatures])

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

    if (passwordValue !== confirmPassword) {
      setError('Las contraseñas deben coincidir para continuar.')
      return
    }

    setLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.delete('specialty')
    selectedSpecs.forEach((s) => formData.append('specialty', s))

    // Doctor range from step 1
    if (doctorRange) formData.set('doctor_range', doctorRange)

    // Pass configurator selections as hidden fields
    const savedConfig = sessionStorage.getItem('omuwan_config')
    if (savedConfig) {
      const config = JSON.parse(savedConfig)
      if (config.plan) formData.set('cfg_plan', config.plan)
      if (config.citas) formData.set('cfg_citas', config.citas)
      if (config.features) formData.set('cfg_features', config.features)
    }

    const result = await registerAction(formData)

    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  const featureList = cfgFeatures?.split(',').filter(Boolean) ?? []
  const featureCount = featureList.length

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
      {/* Configurator summary card */}
      {hasConfig && (
        <div className="mb-6 p-4 bg-[#028090]/5 border border-[#028090]/20 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#028090]/10 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[#028090] text-sm">&#10003;</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Tu plan configurado</p>
              <p className="text-sm text-slate-600 mt-0.5">
                Plan {PLAN_LABELS[cfgPlan ?? ''] ?? cfgPlan}
                {cfgMedicos && <> &middot; {cfgMedicos} médico{cfgMedicos !== '1' ? 's' : ''}</>}
                {featureCount > 0 && <> &middot; {featureCount} features seleccionadas</>}
              </p>
              {featureCount > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {featureList.map((f) => (
                    <span key={f} className="text-xs bg-[#028090]/10 text-[#028090] px-2 py-0.5 rounded-full">
                      {FEATURE_LABELS[f] ?? f}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-[#028090] font-medium mt-2">Primer mes gratis</p>
            </div>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-3 mb-8">
        {STEPS.map((s) => (
          <div key={s.num} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                step >= s.num
                  ? 'bg-[#0f2a6e] text-white'
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
              <div className={`w-8 h-px ${step > s.num ? 'bg-[#0f2a6e]' : 'bg-slate-200'}`} />
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
              className="w-full min-h-[42px] bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer flex flex-wrap gap-1.5 focus-within:ring-2 focus-within:ring-[#29abe2] focus-within:border-transparent transition-all"
              onClick={() => setShowSpecs(!showSpecs)}
            >
              {selectedSpecs.length === 0 && (
                <span className="text-slate-400 text-sm py-0.5">Selecciona especialidades...</span>
              )}
              {selectedSpecs.map((spec) => (
                <span
                  key={spec}
                  className="inline-flex items-center gap-1 bg-[#0f2a6e]/10 text-[#0f2a6e] text-xs font-medium px-2.5 py-1 rounded-full"
                >
                  {spec}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeSpec(spec) }}
                    className="hover:text-[#0f2a6e] transition-colors"
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
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#29abe2]"
                      placeholder="Agregar otra..."
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); addCustomSpec() }}
                      className="bg-[#0f2a6e] hover:bg-[#1a3a8a] text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
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
                      className="rounded border-slate-300 text-[#0f2a6e] focus:ring-[#29abe2]"
                    />
                    <span className="text-slate-700">{spec}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Doctor count selector */}
          <div>
            <label className="label">¿Cuántos médicos atienden en tu consultorio?</label>
            <div className="grid grid-cols-2 gap-3">
              {DOCTOR_OPTIONS.map((opt) => (
                <button
                  key={opt.range}
                  type="button"
                  onClick={() => setDoctorRange(opt.range)}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    doctorRange === opt.range
                      ? 'border-[#028090] bg-[#028090]/5'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <p className={`text-sm font-semibold ${doctorRange === opt.range ? 'text-[#028090]' : 'text-slate-900'}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{opt.price}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-[#028090] font-medium text-center mt-2">
              2 meses gratis &middot; Sin permanencia
            </p>
          </div>

          {specError && (
            <p className="text-sm text-red-600">{specError}</p>
          )}

          <button
            type="button"
            onClick={() => {
              if (selectedSpecs.length === 0) {
                setSpecError('Selecciona al menos una especialidad')
                return
              }
              if (!doctorRange) {
                setSpecError('Selecciona cuántos médicos atienden')
                return
              }
              setSpecError('')
              setStep(2)
            }}
            className="w-full bg-[#0f2a6e] hover:bg-[#1a3a8a] disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
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
              minLength={10}
              autoComplete="new-password"
              className="input-field"
              placeholder="Mínimo 10 caracteres"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="confirm_password">
              Confirmar contraseña
            </label>
            <input
              id="confirm_password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className="input-field"
              placeholder="Repite tu contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {confirmPassword.length > 0 && (
              passwordValue === confirmPassword ? (
                <p className="text-xs text-emerald-600 mt-1">✓ Las contraseñas coinciden</p>
              ) : (
                <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
              )
            )}
          </div>

          {error === 'ALREADY_REGISTERED' ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
              Este email ya tiene una cuenta.{' '}
              <Link href="/login" className="font-semibold underline">
                ¿Quieres iniciar sesión?
              </Link>
            </div>
          ) : error ? (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          ) : null}

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
              className="flex-1 bg-[#5cb85c] hover:bg-[#4cae4c] disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
            >
              {loading ? 'Creando...' : 'Crear cuenta'}
            </button>
          </div>

          <p className="text-xs text-slate-400 text-center">
            Al crear tu cuenta aceptas nuestros{' '}
            <a href="/dashboard/legal" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">
              términos de servicio
            </a>{' '}
            y política de privacidad.
          </p>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="text-[#0f2a6e] hover:text-[#1a3a8a] font-medium">
          Iniciar sesión
        </Link>
      </p>
    </div>
  )
}
