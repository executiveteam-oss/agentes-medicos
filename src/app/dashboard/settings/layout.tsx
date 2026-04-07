// ============================================================
// Layout compartido de Configuración — Tabs de navegación
// ============================================================

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { SettingsTabs } from './settings-tabs'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getUserSession()
  const isDoctor = session ? isDoctorRole(session) : false
  const isSuperAdmin = session?.email === 'executive.team@loncocapital.com'

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Configuración</h1>
        <p className="text-slate-500 text-sm mt-1">
          {isDoctor ? 'Tu perfil y preferencias' : 'Administra tu consultorio, equipo y preferencias'}
        </p>
      </div>

      <SettingsTabs isDoctor={isDoctor} isSuperAdmin={isSuperAdmin} />

      <div className="mt-6">
        {children}
      </div>
    </div>
  )
}
