// ============================================================
// Layout del Dashboard — Sidebar + Top bar con permisos
// Filtra items de nav según los permisos del usuario autenticado
// ============================================================

import { redirect } from 'next/navigation'
import { getUserSession } from '@/lib/session'
import { UserSessionProvider } from '@/context/user-session'
import { NavLink } from '@/components/dashboard/nav-link'
import { logoutAction } from '@/app/actions/auth'
import type { ModuleKey } from '@/types/permissions'

type IconName =
  | 'CalendarDays'
  | 'TrendingDown'
  | 'CreditCard'
  | 'FileText'
  | 'Clock'
  | 'Bot'
  | 'Users'
  | 'BarChart2'
  | 'MessageSquare'
  | 'UserCog'
  | 'Settings'
  | 'Phone'
  | 'Shield'

const ALL_NAV_ITEMS: Array<{
  href: string
  label: string
  iconName: IconName
  module: ModuleKey
}> = [
  { href: '/dashboard', label: 'Agenda', iconName: 'CalendarDays', module: 'agenda' },
  { href: '/dashboard/noshow', label: 'No-Shows', iconName: 'TrendingDown', module: 'noshow' },
  { href: '/dashboard/cartera', label: 'Cartera', iconName: 'CreditCard', module: 'cartera' },
  { href: '/dashboard/facturacion', label: 'Facturación', iconName: 'FileText', module: 'facturacion' },
  { href: '/dashboard/espera', label: 'Lista de espera', iconName: 'Clock', module: 'espera' },
  { href: '/dashboard/patients', label: 'Pacientes', iconName: 'Users', module: 'patients' },
  { href: '/dashboard/conversations', label: 'Conversaciones', iconName: 'MessageSquare', module: 'conversations' },
  { href: '/dashboard/asistente', label: 'Asistente IA', iconName: 'Bot', module: 'asistente' },
  { href: '/dashboard/whatsapp', label: 'WhatsApp', iconName: 'Phone', module: 'whatsapp' },
  { href: '/dashboard/analytics', label: 'Estadísticas', iconName: 'BarChart2', module: 'analytics' },
  { href: '/dashboard/legal', label: 'Legal', iconName: 'Shield', module: 'settings' },
  { href: '/dashboard/settings', label: 'Configuración', iconName: 'Settings', module: 'user_management' },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getUserSession()

  if (!session) {
    redirect('/login')
  }

  // Si no ha completado el onboarding, redirigir
  if (!session.clinic.onboarded_at) {
    redirect('/onboarding')
  }

  // Filtrar nav items según permisos de lectura
  const visibleNavItems = ALL_NAV_ITEMS.filter(
    (item) => session.permissions[item.module]?.read
  )

  // Iniciales para el avatar
  const clinicName = session.clinic?.name ?? 'Clínica'
  const initials = clinicName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'C'

  return (
    <UserSessionProvider session={session}>
      <div className="min-h-screen bg-slate-50 flex">
        {/* Sidebar */}
        <aside className="w-60 bg-[#1e3a5f] flex flex-col shrink-0 fixed inset-y-0 left-0 z-30">
          {/* Clinic branding */}
          <div className="px-5 py-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center">
                <span className="text-sm font-bold text-white">{initials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{clinicName}</p>
                <p className="text-white/50 text-xs truncate">Omuwan</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {visibleNavItems.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} iconName={item.iconName} />
            ))}
          </nav>

          {/* User + logout */}
          <div className="px-4 py-4 border-t border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center">
                <span className="text-xs font-medium text-white">
                  {(session.fullName || 'U').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{session.fullName}</p>
                <p className="text-white/50 text-xs truncate">{session.role?.name ?? 'Sin rol'}</p>
              </div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 ml-60">
          <main className="min-h-screen">
            {children}
          </main>
        </div>
      </div>
    </UserSessionProvider>
  )
}
