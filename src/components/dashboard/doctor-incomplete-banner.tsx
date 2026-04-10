'use client'

// ============================================================
// Banner persistente para doctores con perfil incompleto
// Se muestra cuando dismissed el modal pero no completó horario + tipos
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { markDoctorOnboardingComplete } from '@/app/actions/doctor-onboarding'

export function DoctorIncompleteBanner() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleClick() {
    setLoading(true)
    await markDoctorOnboardingComplete()
    router.push('/dashboard/whatsapp#doctores')
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-800 font-medium">
            Tu perfil está incompleto — los pacientes no pueden agendar citas contigo todavía.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={loading}
          className="bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors shrink-0"
        >
          {loading ? 'Cargando...' : 'Completar ahora →'}
        </button>
      </div>
    </div>
  )
}
