// ============================================================
// Layout del Dashboard — Sidebar v2 + container con permisos
// Identidad "Soft Tech Amigable"
// ============================================================

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { UserSessionProvider } from '@/context/user-session'
import { NavLink } from '@/components/dashboard/nav-link'
import { logoutAction } from '@/app/actions/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isDoctorProfileComplete } from '@/app/actions/doctor-onboarding'
import { DoctorWelcomeModal } from '@/components/dashboard/doctor-welcome-modal'
import { DoctorIncompleteBanner } from '@/components/dashboard/doctor-incomplete-banner'
import { SidebarToggle, SidebarOverlay, LogoutButton } from '@/components/dashboard/sidebar-toggle'
import { NotificationBell } from '@/components/dashboard/notification-bell'
import { HelpChatbotProvider } from '@/components/help-chatbot/provider'
import { HelpChatbotWidget } from '@/components/help-chatbot/widget'
import type { ModuleKey } from '@/types/permissions'
import type { FeatureConfig } from '@/types/database'
import type { IconName } from '@/components/dashboard/nav-link'

interface NavItem {
  href: string
  label: string
  iconName: IconName
  module: ModuleKey
  section: 'operation' | 'config'
  featureKey?: keyof FeatureConfig
}

const ALL_NAV_ITEMS: NavItem[] = [
  // Operacion
  { href: '/dashboard', label: 'Dashboard', iconName: 'LayoutDashboard', module: 'agenda', section: 'operation' },
  { href: '/dashboard/agenda', label: 'Agenda', iconName: 'CalendarDays', module: 'agenda', section: 'operation' },
  { href: '/dashboard/conversations', label: 'Conversaciones', iconName: 'MessageSquare', module: 'conversations', section: 'operation' },
  { href: '/dashboard/patients', label: 'Pacientes', iconName: 'Users', module: 'patients', section: 'operation' },
  { href: '/dashboard/noshow', label: 'No-Shows', iconName: 'TrendingDown', module: 'noshow', section: 'operation' },
  { href: '/dashboard/espera', label: 'Lista de espera', iconName: 'Clock', module: 'espera', section: 'operation', featureKey: 'waitlist' },
  // Configuracion
  { href: '/dashboard/tu-agente', label: 'Tu agente', iconName: 'Sparkles', module: 'whatsapp', section: 'config' },
  { href: '/dashboard/vacaciones', label: 'Vacaciones', iconName: 'Palmtree', module: 'agenda', section: 'config' },
  { href: '/dashboard/stradmed', label: 'Finanzas', iconName: 'CreditCard', module: 'settings', section: 'config' },
  { href: '/dashboard/legal', label: 'Legal', iconName: 'Shield', module: 'settings', section: 'config' },
  { href: '/dashboard/settings', label: 'Configuracion', iconName: 'Settings', module: 'user_management', section: 'config' },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getUserSession()

  if (!session) {
    redirect('/login')
  }

  if (!session.clinic.onboarded_at) {
    redirect('/onboarding')
  }

  const isDoctor = isDoctorRole(session)
  const DOCTOR_ALLOWED_MODULES: ModuleKey[] = ['agenda', 'patients', 'noshow', 'settings']

  const { data: clinicFeatures } = await supabaseAdmin
    .from('clinics')
    .select('feature_config')
    .eq('id', session.clinicId)
    .single()
  const featureConfig = (clinicFeatures?.feature_config ?? null) as FeatureConfig | null

  const DEFAULT_FEATURES: FeatureConfig = {
    agent: true, reminders_24h: true, reminders_72h: true, docs_required: true,
    waitlist: true, reactivation: true, dashboard: true, virtual: true,
    vacations: true,
  }
  const features: FeatureConfig = featureConfig ? { ...DEFAULT_FEATURES, ...featureConfig } : DEFAULT_FEATURES

  const lockedFeatureItems = new Set<string>()

  const visibleNavItems = ALL_NAV_ITEMS.filter((item) => {
    if (!session.permissions[item.module]?.read) return false
    if (isDoctor && !DOCTOR_ALLOWED_MODULES.includes(item.module)) return false
    if (item.featureKey && !features[item.featureKey]) {
      lockedFeatureItems.add(item.href)
    }
    return true
  })

  const operationItems = visibleNavItems.filter((i) => i.section === 'operation')
  const configItems = visibleNavItems.filter((i) => i.section === 'config')

  // Badges
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

  let escalatedBadge = 0
  if (session.permissions.conversations?.read) {
    const { count } = await supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', session.clinicId)
      .eq('status', 'escalated')
    escalatedBadge = count ?? 0
  }

  // Setup progress
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

  const clinicName = session.clinic?.name ?? 'Clinica'

  // Doctor onboarding state
  let showDoctorWelcomeModal = false
  let showDoctorIncompleteBanner = false

  if (isDoctor && session.doctorId) {
    const { data: clinicUserRow } = await supabaseAdmin
      .from('clinic_users')
      .select('onboarding_completed_at')
      .eq('id', session.clinicUserId)
      .maybeSingle()

    const onboardingCompletedAt = (clinicUserRow as { onboarding_completed_at: string | null } | null)?.onboarding_completed_at ?? null

    if (!onboardingCompletedAt) {
      const profileComplete = await isDoctorProfileComplete(session.doctorId, session.clinicId)
      if (!profileComplete) {
        const cookieStore = await cookies()
        const dismissed = cookieStore.get('doctor_modal_dismissed')?.value === '1'
        if (dismissed) {
          showDoctorIncompleteBanner = true
        } else {
          showDoctorWelcomeModal = true
        }
      }
    }
  }

  // User initials
  const userInitials = (session.fullName || 'U')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  function getBadge(href: string): number | undefined {
    if (href === '/dashboard/espera') return esperaBadge
    if (href === '/dashboard/conversations') return escalatedBadge
    return undefined
  }

  function getBadgeColor(href: string): 'pink' | 'blue' {
    if (href === '/dashboard/conversations') return 'pink'
    return 'blue'
  }

  return (
    <UserSessionProvider session={session}>
      <div className="min-h-screen flex" style={{ background: 'var(--v2-bg)' }}>
        {/* ===== Sidebar ===== */}
        <aside
          id="sidebar"
          className="fixed inset-y-0 left-0 z-40 w-[252px] flex-col hidden lg:flex"
          style={{
            background: 'var(--v2-bg-card)',
            borderRight: '1px solid var(--v2-border-soft)',
            fontFamily: 'var(--font-manrope), sans-serif',
          }}
        >
          {/* Logo + Clinic */}
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-2.5 mb-4">
              <div
                className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                style={{
                  background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                  boxShadow: '0 2px 8px rgba(107, 91, 255, 0.25)',
                }}
              >
                <span className="text-white font-extrabold text-sm" style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>O</span>
              </div>
              <span
                className="font-extrabold text-[17px] tracking-tight"
                style={{ color: 'var(--v2-text)', fontFamily: 'var(--font-manrope), sans-serif' }}
              >
                Omuwan
              </span>
            </div>

            <div
              className="flex items-center gap-2 px-2.5 py-2 rounded-[9px]"
              style={{ background: 'var(--v2-bg-soft)' }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'var(--v2-primary-soft)' }}
              >
                <span className="text-[11px] font-bold" style={{ color: 'var(--v2-primary)' }}>
                  {clinicName.charAt(0).toUpperCase()}
                </span>
              </div>
              <p
                className="text-[13px] font-semibold truncate"
                style={{ color: 'var(--v2-text)' }}
              >
                {clinicName}
                {setupPercentage !== null && (
                  <span className="font-normal text-[11px]" style={{ color: 'var(--v2-text-subtle)' }}> ({setupPercentage}%)</span>
                )}
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 overflow-y-auto">
            {operationItems.length > 0 && (
              <div className="mb-5">
                <p
                  className="text-[11px] font-semibold uppercase tracking-widest px-3 mb-1.5"
                  style={{ color: 'var(--v2-text-subtle)' }}
                >
                  Operacion
                </p>
                <div className="flex flex-col gap-px">
                  {operationItems.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      iconName={item.iconName}
                      badge={getBadge(item.href)}
                      badgeColor={getBadgeColor(item.href)}
                      locked={lockedFeatureItems.has(item.href)}
                    />
                  ))}
                </div>
              </div>
            )}

            {configItems.length > 0 && (
              <div className="mb-5">
                <p
                  className="text-[11px] font-semibold uppercase tracking-widest px-3 mb-1.5"
                  style={{ color: 'var(--v2-text-subtle)' }}
                >
                  Configuracion
                </p>
                <div className="flex flex-col gap-px">
                  {configItems.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      iconName={item.iconName}
                      badge={getBadge(item.href)}
                      badgeColor={getBadgeColor(item.href)}
                      locked={lockedFeatureItems.has(item.href)}
                    />
                  ))}
                </div>
              </div>
            )}
          </nav>

          {/* User card + Logout */}
          <div className="px-3 pb-4 pt-3" style={{ borderTop: '1px solid var(--v2-border-soft)' }}>
            <div
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] mb-2"
              style={{ background: 'var(--v2-bg-soft)' }}
            >
              <div
                className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0"
                style={{
                  background: 'linear-gradient(135deg, var(--v2-primary-soft), var(--v2-pink-soft))',
                  border: '1px solid var(--v2-border)',
                }}
              >
                <span className="text-[11px] font-bold" style={{ color: 'var(--v2-primary)' }}>
                  {userInitials}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--v2-text)' }}>
                  {session.fullName}
                </p>
                <p className="text-[11px] truncate" style={{ color: 'var(--v2-text-subtle)' }}>
                  {session.role?.name ?? 'Sin rol'}
                </p>
              </div>
            </div>
            <LogoutButton action={logoutAction} />
          </div>
        </aside>

        {/* Mobile overlay */}
        <SidebarOverlay />

        {/* ===== Main content ===== */}
        <div className="flex-1 lg:ml-[252px] min-h-screen flex flex-col">
          {/* Top header */}
          <header
            className="sticky top-0 z-20 flex items-center h-14 px-4 lg:px-8"
            style={{
              background: 'rgba(251, 250, 253, 0.85)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderBottom: '1px solid var(--v2-border-soft)',
            }}
          >
            <SidebarToggle />
            <div className="flex-1" />
            <NotificationBell />
          </header>

          {/* Page content */}
          <main
            className="flex-1 px-4 py-6 lg:px-8 lg:py-8"
            style={{
              backgroundImage: 'radial-gradient(circle at 0% 0%, rgba(107, 91, 255, 0.04), transparent 40%), radial-gradient(circle at 100% 100%, rgba(255, 107, 170, 0.03), transparent 40%)',
            }}
          >
            {showDoctorIncompleteBanner && <DoctorIncompleteBanner />}
            {children}
          </main>
        </div>

        {showDoctorWelcomeModal && (
          <DoctorWelcomeModal fullName={session.fullName} clinicName={clinicName} />
        )}

        {/* Help chatbot */}
        <HelpChatbotProvider>
          <HelpChatbotWidget />
        </HelpChatbotProvider>
      </div>
    </UserSessionProvider>
  )
}
