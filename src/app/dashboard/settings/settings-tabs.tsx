'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/settings/clinic', label: 'Consultorio' },
  { href: '/dashboard/settings/users', label: 'Usuarios' },
  { href: '/dashboard/settings/roles', label: 'Roles y permisos' },
  { href: '/dashboard/settings/notifications', label: 'Notificaciones' },
  { href: '/dashboard/settings/legal', label: 'Contrato y Legal' },
]

export function SettingsTabs() {
  const pathname = usePathname()

  return (
    <div className="flex border-b border-slate-200 overflow-x-auto">
      {TABS.map((tab) => {
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
