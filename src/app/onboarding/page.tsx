'use client'

// ============================================================
// Wizard de onboarding — 4 pasos para configurar la clínica
// Ruta: /onboarding
// ============================================================

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateClinicData,
  inviteUser,
  updateWhatsappConfig,
  markOnboarded,
  getClinicRoles,
} from '@/app/actions/onboarding'

// Tipos locales
type Step = 1 | 2 | 3 | 4 | 5

const STEP_LABELS = ['Consultorio', 'Equipo', 'WhatsApp', 'Listo']

// ============================================================
// Progress bar + step labels
// ============================================================
function ProgressBar({ current }: { current: Step }) {
  const totalSteps = 4
  const progress = ((current - 1) / (totalSteps - 1)) * 100

  return (
    <div className="mb-10">
      {/* Progress track */}
      <div className="relative mb-4">
        <div className="h-1.5 bg-slate-200 rounded-full">
          <div
            className="h-1.5 bg-blue-700 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        {/* Step dots on the track */}
        <div className="absolute top-1/2 -translate-y-1/2 flex justify-between w-full">
          {STEP_LABELS.map((_, i) => {
            const stepNum = i + 1
            const isCompleted = current > stepNum
            const isActive = current === stepNum
            return (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all duration-300 ${
                  isCompleted
                    ? 'bg-blue-700 border-blue-700'
                    : isActive
                    ? 'bg-white border-blue-700 ring-4 ring-blue-100'
                    : 'bg-white border-slate-300'
                }`}
              />
            )
          })}
        </div>
      </div>
      {/* Labels */}
      <div className="flex justify-between">
        {STEP_LABELS.map((label, i) => {
          const stepNum = i + 1
          return (
            <span
              key={i}
              className={`text-xs font-medium transition-colors ${
                current >= stepNum ? 'text-blue-700' : 'text-slate-400'
              }`}
            >
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

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

// ============================================================
// Paso 1: Datos de la clínica
// ============================================================
function Step1({ onNext }: { onNext: () => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedSpecs, setSelectedSpecs] = useState<string[]>([])
  const [customSpec, setCustomSpec] = useState('')
  const [showSpecs, setShowSpecs] = useState(false)
  const specsRef = useRef<HTMLDivElement>(null)

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
    setLoading(true)
    setError('')

    const fd = new FormData(e.currentTarget)
    const result = await updateClinicData({
      name: fd.get('name') as string,
      address: fd.get('address') as string,
      city: fd.get('city') as string,
      phone: fd.get('phone') as string,
      consultation_price: parseInt(fd.get('consultation_price') as string) || 0,
      consultation_duration_minutes: parseInt(fd.get('duration') as string) || 30,
      specialty: selectedSpecs,
    })

    if (result.error) {
      setError(result.error)
      setLoading(false)
    } else {
      onNext()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Nombre del consultorio *</label>
          <input name="name" required className="input-field" placeholder="Consultorio Médico Dr. García" />
        </div>

        {/* Multi-select de especialidades */}
        <div className="col-span-2 relative" ref={specsRef}>
          <label className="label">Especialidades</label>
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
          {showSpecs && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
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

        <div className="col-span-2">
          <label className="label">Dirección</label>
          <input name="address" className="input-field" placeholder="Cra 10 #25-30, Pereira" />
        </div>
        <div>
          <label className="label">Ciudad</label>
          <input name="city" defaultValue="Pereira" className="input-field" />
        </div>
        <div>
          <label className="label">Teléfono de contacto</label>
          <input name="phone" className="input-field" placeholder="+57 300 000 0000" />
        </div>
        <div>
          <label className="label">Precio consulta (COP)</label>
          <input name="consultation_price" type="number" min="0" className="input-field" placeholder="80000" />
        </div>
        <div>
          <label className="label">Duración consulta (min)</label>
          <input name="duration" type="number" min="10" max="120" defaultValue="30" className="input-field" />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? 'Guardando...' : 'Continuar'}
      </button>
    </form>
  )
}

// ============================================================
// Paso 2: Invitar equipo
// ============================================================
function Step2({ onNext }: { onNext: () => void }) {
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [invites, setInvites] = useState<string[]>([])

  // Cargar roles al montar
  useState(() => {
    getClinicRoles().then(setRoles)
  })

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const fd = new FormData(e.currentTarget)
    const result = await inviteUser({
      email: fd.get('email') as string,
      full_name: fd.get('full_name') as string,
      role_id: fd.get('role_id') as string,
    })

    if (result.error) {
      setError(result.error)
    } else {
      setInvites((prev) => [...prev, fd.get('email') as string])
      ;(e.target as HTMLFormElement).reset()
    }
    setLoading(false)
  }

  return (
    <div className="space-y-5">
      <p className="text-slate-500 text-sm">
        Invita a tu equipo (secretaria, coordinadora, contador). Recibirán un email para crear su contraseña.
        Puedes saltarte este paso si deseas hacerlo después.
      </p>

      {invites.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <p className="text-emerald-800 text-sm font-medium mb-2">Invitaciones enviadas:</p>
          {invites.map((email) => (
            <div key={email} className="flex items-center gap-2 text-emerald-700 text-sm">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {email}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleInvite} className="card p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre completo</label>
            <input name="full_name" required className="input-field" placeholder="Ana García" />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" required className="input-field" placeholder="ana@consultorio.com" />
          </div>
        </div>
        <div>
          <label className="label">Rol</label>
          <select name="role_id" required className="input-field">
            <option value="">Selecciona un rol</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-secondary w-full">
          {loading ? 'Enviando...' : 'Enviar invitación'}
        </button>
      </form>

      <button onClick={onNext} className="btn-primary w-full">
        Continuar
      </button>
    </div>
  )
}

// ============================================================
// Paso 3: WhatsApp (skippable)
// ============================================================
function Step3({ onNext }: { onNext: () => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const fd = new FormData(e.currentTarget)
    await updateWhatsappConfig({
      whatsapp_phone_id: fd.get('phone_id') as string,
      whatsapp_token: fd.get('token') as string,
    })

    onNext()
  }

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-blue-800 text-sm leading-relaxed">
            Para conectar WhatsApp necesitas una cuenta de Meta Business Manager con WhatsApp Business API.
            Puedes configurar esto ahora o más tarde en Configuración.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Phone Number ID</label>
          <input name="phone_id" className="input-field" placeholder="123456789012345" />
        </div>
        <div>
          <label className="label">Access Token</label>
          <input name="token" type="password" className="input-field" placeholder="EAAG..." />
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Guardando...' : 'Guardar y continuar'}
        </button>
      </form>

      <button
        onClick={onNext}
        className="w-full text-center text-slate-500 hover:text-slate-700 text-sm py-2 transition-colors"
      >
        Saltar por ahora
      </button>
    </div>
  )
}

// ============================================================
// Paso 4: Resumen y finalizar
// ============================================================
function Step4() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleFinish() {
    setLoading(true)
    setError('')

    const result = await markOnboarded()
    if (result.error) {
      setError(result.error)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="space-y-6 text-center">
      <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
        <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-slate-900 mb-2">¡Todo listo!</h3>
        <p className="text-slate-500">
          Tu consultorio está configurado. Ya puedes empezar a usar Omuwan para gestionar tus citas.
        </p>
      </div>

      <div className="card p-5 text-left space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Próximos pasos</p>
        <ul className="space-y-3">
          {[
            'Completa la configuración de WhatsApp en Ajustes',
            'Agrega el horario de tu doctor',
            'Personaliza las FAQ de tu asistente IA',
            'Comparte el número de WhatsApp con tus pacientes',
          ].map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-slate-600">
              <div className="w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-700" />
              </div>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <button onClick={handleFinish} disabled={loading} className="btn-primary w-full">
        {loading ? 'Iniciando...' : 'Ir al dashboard'}
      </button>
    </div>
  )
}

// ============================================================
// Página principal del onboarding
// ============================================================
export default function OnboardingPage() {
  const [step, setStep] = useState<Step>(1)

  const next = () => setStep((s) => (s < 5 ? (s + 1) as Step : s))

  return (
    <div>
      <ProgressBar current={step} />

      <div className="card p-8">
        {step < 4 && (
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-6">
            {STEP_LABELS[step - 1]}
          </h2>
        )}

        {step === 1 && <Step1 onNext={next} />}
        {step === 2 && <Step2 onNext={next} />}
        {step === 3 && <Step3 onNext={next} />}
        {(step === 4 || step === 5) && <Step4 />}
      </div>
    </div>
  )
}
