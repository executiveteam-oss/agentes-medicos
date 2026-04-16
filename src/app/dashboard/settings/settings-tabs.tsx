'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ALL_TABS = [
  { href: '/dashboard/settings/clinic', label: 'Consultorio', doctorVisible: true, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/plan', label: 'Mi plan', doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/whatsapp#doctores', label: 'Médicos', doctorVisible: false, superAdminOnly: false, external: true },
  { href: '/dashboard/settings/whatsapp', label: 'WhatsApp', doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/integrations', label: 'Integraciones', doctorVisible: false, superAdminOnly: false, external: false },
  // Importación de iSalud movida a WhatsApp → Doctores → cada médico → "Importar desde iSalud"
  { href: '/dashboard/settings/users', label: 'Usuarios', doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/roles', label: 'Roles y permisos', doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/notifications', label: 'Notificaciones', doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/legal', label: 'Contrato y Legal', doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/system-status', label: 'Sistema', doctorVisible: false, superAdminOnly: true, external: false },
]

export function SettingsTabs({ isDoctor = false, isSuperAdmin = false }: { isDoctor?: boolean; isSuperAdmin?: boolean }) {
  const pathname = usePathname()
  const tabs = ALL_TABS
    .filter((t) => !isDoctor || t.doctorVisible)
    .filter((t) => !t.superAdminOnly || isSuperAdmin)

  return (
    <div className="flex border-b border-slate-200 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              isActive
                ? 'text-blue-700 border-blue-700'
                : 'text-slate-500 border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
