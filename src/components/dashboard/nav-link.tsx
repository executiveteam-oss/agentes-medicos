'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarDays,
  TrendingDown,
  CreditCard,
  FileText,
  Clock,
  Bot,
  Users,
  BarChart2,
  MessageSquare,
  UserCog,
  Settings,
  Phone,
  Shield,
  Lightbulb,
  Palmtree,
  Lock,
  LayoutDashboard,
  Sparkles,
  Stethoscope,
} from 'lucide-react'

const ICON_MAP = {
  CalendarDays,
  TrendingDown,
  CreditCard,
  FileText,
  Clock,
  Bot,
  Users,
  BarChart2,
  MessageSquare,
  UserCog,
  Settings,
  Phone,
  Shield,
  Lightbulb,
  Palmtree,
  LayoutDashboard,
  Sparkles,
  Stethoscope,
} as const

export type IconName = keyof typeof ICON_MAP

interface NavLinkProps {
  href: string
  label: string
  iconName: IconName
  badge?: number
  badgeColor?: 'blue' | 'red' | 'pink'
  locked?: boolean
}

export function NavLink({ href, label, iconName, badge, badgeColor = 'blue', locked = false }: NavLinkProps) {
  const pathname = usePathname()
  const isActive = href === '/dashboard' ? pathname === href : pathname.startsWith(href)
  const Icon = ICON_MAP[iconName]

  return (
    <Link
      href={href}
      className="group block"
      style={{ textDecoration: 'none' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '9px 12px',
          borderRadius: '9px',
          fontSize: '13.5px',
          fontWeight: isActive ? 700 : 500,
          fontFamily: 'var(--font-manrope), sans-serif',
          transition: 'all 0.15s ease',
          cursor: locked ? 'default' : 'pointer',
          ...(locked
            ? {
                color: 'var(--v2-text-subtle)',
                opacity: 0.5,
              }
            : isActive
              ? {
                  background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)',
                  color: '#ffffff',
                  boxShadow: '0 2px 8px rgba(107, 91, 255, 0.3)',
                }
              : {
                  color: 'var(--v2-text-muted)',
                  background: 'transparent',
                }),
        }}
        onMouseEnter={(e) => {
          if (!isActive && !locked) {
            e.currentTarget.style.background = 'var(--v2-bg-soft)'
            e.currentTarget.style.color = 'var(--v2-text)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive && !locked) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--v2-text-muted)'
          }
        }}
      >
        <Icon
          size={16}
          style={{
            flexShrink: 0,
            opacity: locked ? 0.4 : 1,
            color: isActive ? '#ffffff' : locked ? 'var(--v2-text-subtle)' : 'var(--v2-text-subtle)',
          }}
        />
        <span style={{ flex: 1 }}>{label}</span>
        {locked && <Lock size={12} style={{ color: 'var(--v2-text-subtle)', opacity: 0.5 }} />}
        {!locked && badge != null && badge > 0 && (
          <span
            style={{
              background: badgeColor === 'red' || badgeColor === 'pink' ? 'var(--v2-pink)' : 'var(--v2-primary)',
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: '999px',
              minWidth: '18px',
              textAlign: 'center',
              lineHeight: '16px',
            }}
          >
            {badge}
          </span>
        )}
      </div>
    </Link>
  )
}
