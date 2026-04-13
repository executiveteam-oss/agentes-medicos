'use client'

// ============================================================
// Página de acceso anticipado — Waitlist
// Ruta: /register
// Los usuarios con código de invitación van a /register/invite
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { submitAccessRequest, validateInviteCode } from '@/app/actions/access-waitlist'

const DOCTOR_OPTIONS = [
  { value: '1', label: '1 médico' },
  { value: '2-3', label: '2-3 médicos' },
  { value: '4-6', label: '4-6 médicos' },
  { value: '7-10', label: '7-10 médicos' },
  { value: '11+', label: '11+ médicos' },
]

export default function RegisterPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const fd = new FormData(e.currentTarget)
    const result = await submitAccessRequest({
      fullName: fd.get('full_name') as string,
      clinicName: fd.get('clinic_name') as string,
      city: fd.get('city') as string,
      email: fd.get('email') as string,
      whatsapp: fd.get('whatsapp') as string,
      specialty: fd.get('specialty') as string,
      doctorRange: fd.get('doctor_range') as string,
    })

    if (result.ok) {
      setSubmitted(true)
    } else {
      setError(result.error ?? 'Error enviando solicitud')
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center space-y-5">
        <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-slate-900">¡Solicitud recibida!</h2>
        <p className="text-sm text-slate-500 max-w-xs mx-auto">
          Te contactaremos en menos de 24 horas por WhatsApp. Revisa también tu correo.
        </p>
        <Link
          href="/landing/"
          className="inline-block bg-[#0f2a6e] hover:bg-[#1a3a8a] text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
        >
          Volver al inicio
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">Acceso anticipado</h2>
      <p className="text-sm text-slate-500 mb-6">
        Omuwan está en fase de lanzamiento privado. Déjanos tus datos y te contactamos en menos de 24 horas.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="full_name">Nombre completo *</label>
          <input id="full_name" name="full_name" type="text" required className="input-field" placeholder="Dr. Juan García" />
        </div>

        <div>
          <label className="label" htmlFor="clinic_name">Nombre del consultorio *</label>
          <input id="clinic_name" name="clinic_name" type="text" required className="input-field" placeholder="Consultorio Médico Dr. García" />
        </div>

        <div>
          <label className="label" htmlFor="city">Ciudad *</label>
          <input id="city" name="city" type="text" required className="input-field" placeholder="Pereira" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="email">Email *</label>
            <input id="email" name="email" type="email" required className="input-field" placeholder="tu@consultorio.com" />
          </div>
          <div>
            <label className="label" htmlFor="whatsapp">WhatsApp *</label>
            <input id="whatsapp" name="whatsapp" type="tel" required className="input-field" placeholder="300 000 0000" />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="specialty">Especialidad médica</label>
          <input id="specialty" name="specialty" type="text" className="input-field" placeholder="Ej: Odontología, Medicina General..." />
        </div>

        <div>
          <label className="label" htmlFor="doctor_range">Número de médicos</label>
          <select id="doctor_range" name="doctor_range" className="input-field">
            <option value="">Selecciona...</option>
            {DOCTOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0f2a6e] hover:bg-[#1a3a8a] disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
        >
          {loading ? 'Enviando...' : 'Solicitar acceso'}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3 mt-6 mb-4">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400">o si ya tienes código</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Path B: Invite code */}
      <InviteCodeSection />

      <p className="mt-5 text-center text-sm text-slate-500">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="text-[#0f2a6e] hover:text-[#1a3a8a] font-medium">
          Iniciar sesión
        </Link>
      </p>
    </div>
  )
}

function InviteCodeSection() {
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [checking, setChecking] = useState(false)
  const router = useRouter()

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setCodeError('')
    const trimmed = code.trim()
    if (!trimmed) { setCodeError('Ingresa tu código'); return }

    setChecking(true)
    const result = await validateInviteCode(trimmed)
    setChecking(false)

    if (result.valid) {
      router.push(`/register/invite?code=${encodeURIComponent(trimmed)}`)
    } else {
      setCodeError('Código inválido. ¿No tienes código? Solicita acceso arriba.')
    }
  }

  return (
    <form onSubmit={handleCodeSubmit} className="space-y-2">
      <label className="text-xs font-medium text-slate-500 block">Código de invitación</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value); setCodeError('') }}
          className="input-field flex-1"
          placeholder="Ingresa tu código"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={checking}
          className="bg-[#028090] hover:bg-[#026d7a] disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0"
        >
          {checking ? '...' : 'Acceder'}
        </button>
      </div>
      {codeError && (
        <p className="text-xs text-red-500">{codeError}</p>
      )}
    </form>
  )
}
