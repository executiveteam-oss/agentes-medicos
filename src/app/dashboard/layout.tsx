// ============================================================
// Layout del Dashboard — Sidebar + Top bar con permisos
// Filtra items de nav según los permisos del usuario autenticado
// ============================================================

import { redirect } from 'next/navigation'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { UserSessionProvider } from '@/context/user-session'
import { NavLink } from '@/components/dashboard/nav-link'
import { logoutAction } from '@/app/actions/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { ModuleKey } from '@/types/permissions'
import type { FeatureConfig } from '@/types/database'

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
  | 'Lightbulb'

const ALL_NAV_ITEMS: Array<{
  href: string
  label: string
  iconName: IconName
  module: ModuleKey
  featureKey?: keyof FeatureConfig  // Si está definido, se verifica feature_config
}> = [
  { href: '/dashboard', label: 'Agenda', iconName: 'CalendarDays', module: 'agenda' },
  { href: '/dashboard/noshow', label: 'No-Shows', iconName: 'TrendingDown', module: 'noshow' },
  { href: '/dashboard/cartera', label: 'Cartera', iconName: 'CreditCard', module: 'cartera', featureKey: 'cartera' },
  { href: '/dashboard/facturacion', label: 'Facturación', iconName: 'FileText', module: 'facturacion', featureKey: 'facturacion' },
  { href: '/dashboard/espera', label: 'Lista de espera', iconName: 'Clock', module: 'espera', featureKey: 'waitlist' },
  { href: '/dashboard/patients', label: 'Pacientes', iconName: 'Users', module: 'patients' },
  { href: '/dashboard/conversations', label: 'Conversaciones', iconName: 'MessageSquare', module: 'conversations' },
  { href: '/dashboard/asistente', label: 'Asistente IA', iconName: 'Bot', module: 'asistente', featureKey: 'ai_assistant' },
  { href: '/dashboard/whatsapp', label: 'WhatsApp', iconName: 'Phone', module: 'whatsapp' },
  { href: '/dashboard/analytics', label: 'Estadísticas', iconName: 'BarChart2', module: 'analytics', featureKey: 'estadisticas' },
  { href: '/dashboard/insights', label: 'Insights', iconName: 'Lightbulb', module: 'analytics', featureKey: 'insights' },
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
  // Doctores: solo ven Agenda, Pacientes, No-Shows, Estadísticas, Configuración
  const isDoctor = isDoctorRole(session)
  const DOCTOR_ALLOWED_MODULES: ModuleKey[] = ['agenda', 'patients', 'noshow', 'analytics', 'settings']

  // Leer feature_config de la clínica
  const { data: clinicFeatures } = await supabaseAdmin
    .from('clinics')
    .select('feature_config')
    .eq('id', session.clinicId)
    .single()
  const featureConfig = (clinicFeatures?.feature_config ?? null) as FeatureConfig | null

  // Defaults: todas las features activas si no hay config (clínicas existentes)
  const DEFAULT_FEATURES: FeatureConfig = {
    agent: true, reminders_24h: true, reminders_72h: true, docs_required: true,
    waitlist: true, reactivation: true, dashboard: true, insights: true, virtual: true,
    vacations: true, ai_assistant: true, cartera: true, facturacion: true, estadisticas: true,
  }
  const features: FeatureConfig = featureConfig ? { ...DEFAULT_FEATURES, ...featureConfig } : DEFAULT_FEATURES

  // Items gated por feature: se muestran como locked si la feature está desactivada
  const lockedFeatureItems = new Set<string>()

  const visibleNavItems = ALL_NAV_ITEMS.filter((item) => {
    if (!session.permissions[item.module]?.read) return false
    if (isDoctor && !DOCTOR_ALLOWED_MODULES.includes(item.module)) return false
    // Feature gating: si el item tiene featureKey y está desactivado, marcarlo como locked
    if (item.featureKey && !features[item.featureKey]) {
      lockedFeatureItems.add(item.href)
    }
    return true
  })

  // Badge: contar solicitudes manuales pendientes para Lista de espera
  let esperaBadge = 0
  if (session.permissions.espera?.read) {
    const { count } = await supabaseAdmin
      .from('waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', session.clinicId)
      .eq('status', 'waiting')
      .eq('source', 'whatsapp')
    esperaBadge = count ?? 0
  }

  // Badge: contar insights no leídos de hoy
  let insightsBadge = 0
  if (session.permissions.analytics?.read && !isDoctor) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { count } = await supabaseAdmin
      .from('clinic_insights')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', session.clinicId)
      .eq('is_read', false)
      .gte('generated_at', todayStart.toISOString())
    insightsBadge = count ?? 0
  }

  // Badge: contar conversaciones escaladas (urgentes) sin resolver
  let escalatedBadge = 0
  if (session.permissions.conversations?.read) {
    const { count } = await supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', session.clinicId)
      .eq('status', 'escalated')
    escalatedBadge = count ?? 0
  }

  // Progreso de setup para mostrar porcentaje en sidebar
  let setupPercentage: number | null = null
  if (!isDoctor) {
    const { data: setupRow } = await supabaseAdmin
      .from('clinic_setup_progress')
      .select('clinic_data_complete, doctors_added, consultation_types_added, whatsapp_connected, team_invited, completed_at')
      .eq('clinic_id', session.clinicId)
      .single()
    if (setupRow && !setupRow.completed_at) {
      const steps = [setupRow.clinic_data_complete, setupRow.doctors_added, setupRow.consultation_types_added, setupRow.whatsapp_connected, setupRow.team_invited]
      const done = steps.filter(Boolean).length
      setupPercentage = Math.round((done / steps.length) * 100)
    }
  }

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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/omuwan-logo.png"
                alt="Omuwan"
                style={{ height: '32px', width: 'auto', borderRadius: '6px' }}
              />
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">
                  {clinicName}{setupPercentage !== null && <span className="text-white/50 font-normal"> ({setupPercentage}%)</span>}
                </p>
                <p className="text-white/50 text-xs truncate">Omuwan</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {visibleNavItems.map((item) => {
              const isLocked = lockedFeatureItems.has(item.href)
              return (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  iconName={item.iconName}
                  badge={
                    item.href === '/dashboard/espera' ? esperaBadge
                      : item.href === '/dashboard/conversations' ? escalatedBadge
                        : item.href === '/dashboard/insights' ? insightsBadge
                          : undefined
                  }
                  badgeColor={item.href === '/dashboard/conversations' ? 'red' : item.href === '/dashboard/insights' ? 'red' : 'blue'}
                  locked={isLocked}
                />
              )
            })}
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
