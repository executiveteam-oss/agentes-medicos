// ============================================================
// Layout del Onboarding — sin sidebar, con header limpio
// Ruta: /onboarding
// ============================================================

import { redirect } from 'next/navigation'
import { getUserSession } from '@/lib/session'

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await getUserSession()

  if (!session) {
    redirect('/login')
  }

  // Si ya completó el onboarding, ir al dashboard
  if (session.clinic.onboarded_at) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-700 flex items-center justify-center">
              <span className="text-sm font-bold text-white">O</span>
            </div>
            <p className="text-slate-900 font-semibold text-lg">Omuwan</p>
          </div>
          <p className="text-slate-500 text-sm">Configuración inicial</p>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-10">
        {children}
      </main>
    </div>
  )
}
