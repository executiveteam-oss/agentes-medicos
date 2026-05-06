// ============================================================
// Layout de Configuracion v2 — Sub-nav con tabs gradient
// ============================================================

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { SettingsTabs } from './settings-tabs'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getUserSession()
  const isDoctor = session ? isDoctorRole(session) : false
  const isSuperAdmin = session?.email === 'executive.team@loncocapital.com'

  return (
    <div className="max-w-4xl" style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--v2-text)', letterSpacing: '-0.025em' }}>
          Configuración
        </h1>
        <p style={{ fontSize: '13.5px', color: 'var(--v2-text-muted)', marginTop: '4px' }}>
          {isDoctor ? 'Tu perfil y preferencias' : 'Personaliza tu clínica, agente y operación'}
        </p>
      </div>

      <SettingsTabs isDoctor={isDoctor} isSuperAdmin={isSuperAdmin} />

      <div style={{ marginTop: '20px' }}>
        {children}
      </div>
    </div>
  )
}
