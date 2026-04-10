'use client'

// ============================================================
// Modal de bienvenida para doctores en primer login
// Solo se muestra si onboarding_completed_at es NULL
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { markDoctorOnboardingComplete } from '@/app/actions/doctor-onboarding'

interface DoctorWelcomeModalProps {
  fullName: string
  clinicName: string
}

export function DoctorWelcomeModal({ fullName, clinicName }: DoctorWelcomeModalProps) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  if (!open) return null

  // Calcular tratamiento Dr./Dra. heurístico
  const firstName = fullName.split(' ')[0] ?? ''
  const treatment = /a$/i.test(firstName) ? 'Dra.' : 'Dr.'

  async function handleConfigure() {
    setLoading(true)
    await markDoctorOnboardingComplete()
    router.push('/dashboard/whatsapp#doctores')
  }

  function handleLater() {
    // Solo cierra el modal — no marca onboarding completo
    document.cookie = 'doctor_modal_dismissed=1; path=/; max-age=86400'
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-[480px] w-full p-8 space-y-5">
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/omuwan-logo.png" alt="Omuwan" className="mx-auto" style={{ height: '48px', width: 'auto', borderRadius: '8px' }} />

        {/* Greeting */}
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900">
            Bienvenido/a, {treatment} {fullName}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {clinicName} ya está configurando su agente inteligente de WhatsApp.
          </p>
        </div>

        <hr className="border-slate-100" />

        <p className="text-sm text-slate-700">
          Para que los pacientes puedan agendar citas contigo, necesitas completar 2 cosas:
        </p>

        {/* Action cards */}
        <div className="space-y-3">
          <div className="border-2 border-[#028090]/30 rounded-xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#028090]/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-[#028090]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Tu horario de atención</p>
              <p className="text-xs text-slate-500 mt-0.5">Define qué días y horas atiendes</p>
            </div>
          </div>

          <div className="border-2 border-[#028090]/30 rounded-xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#028090]/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-[#028090]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Tus tipos de consulta</p>
              <p className="text-xs text-slate-500 mt-0.5">Qué consultas ofreces, duración y documentos requeridos</p>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="space-y-2 pt-2">
          <button
            type="button"
            onClick={handleConfigure}
            disabled={loading}
            className="w-full bg-[#028090] hover:bg-[#026d7a] disabled:opacity-60 text-white font-semibold py-2.5 px-5 rounded-lg transition-colors"
          >
            {loading ? 'Cargando...' : 'Configurar mi perfil →'}
          </button>
          <button
            type="button"
            onClick={handleLater}
            className="w-full text-slate-500 hover:text-slate-700 text-sm py-2 transition-colors"
          >
            Lo haré después
          </button>
        </div>
      </div>
    </div>
  )
}
