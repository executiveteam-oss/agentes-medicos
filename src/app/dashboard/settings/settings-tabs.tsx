'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  CreditCard,
  MessageSquare,
  Users,
  Shield,
  Bell,
  FileText,
  ServerCog,
} from 'lucide-react'

// "Médicos" se sacó de aquí el 2026-06-25 — ahora vive en /dashboard/doctors
// como item top-level del sidebar ("Médicos y servicios"). Ver layout.tsx.
const ALL_TABS = [
  { href: '/dashboard/settings/clinic', label: 'Consultorio', icon: Building2, doctorVisible: true, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/plan', label: 'Plan', icon: CreditCard, doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/whatsapp', label: 'WhatsApp', icon: MessageSquare, doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/users', label: 'Equipo', icon: Users, doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/roles', label: 'Permisos', icon: Shield, doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/notifications', label: 'Notificaciones', icon: Bell, doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/legal', label: 'Legal', icon: FileText, doctorVisible: false, superAdminOnly: false, external: false },
  { href: '/dashboard/settings/system-status', label: 'Sistema', icon: ServerCog, doctorVisible: false, superAdminOnly: true, external: false },
]

export function SettingsTabs({ isDoctor = false, isSuperAdmin = false }: { isDoctor?: boolean; isSuperAdmin?: boolean }) {
  const pathname = usePathname()
  const tabs = ALL_TABS
    .filter((t) => !isDoctor || t.doctorVisible)
    .filter((t) => !t.superAdminOnly || isSuperAdmin)

  return (
    <div
      style={{
        display: 'flex',
        gap: '4px',
        padding: '5px',
        borderRadius: 'var(--v2-radius-lg)',
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        boxShadow: 'var(--v2-shadow-sm)',
        overflowX: 'auto',
      }}
    >
      {tabs.map((tab) => {
        const isActive = !tab.external && (pathname === tab.href || pathname.startsWith(tab.href + '/'))
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 16px',
              borderRadius: '10px',
              fontSize: '12.5px',
              fontWeight: isActive ? 700 : 600,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              fontFamily: 'var(--font-manrope), sans-serif',
              transition: 'all 0.15s',
              ...(isActive
                ? {
                    background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)',
                    color: '#fff',
                    boxShadow: '0 2px 6px rgba(107, 91, 255, 0.25)',
                  }
                : {
                    color: 'var(--v2-text-muted)',
                    background: 'transparent',
                  }),
            }}
          >
            <Icon size={14} />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
