// ============================================================
// Layout compartido de Configuración — Tabs de navegación
// ============================================================

import { SettingsTabs } from './settings-tabs'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Configuración</h1>
        <p className="text-slate-500 text-sm mt-1">Administra tu consultorio, equipo y preferencias</p>
      </div>

      <SettingsTabs />

      <div className="mt-6">
        {children}
      </div>
    </div>
  )
}
