'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
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
} as const

type IconName = keyof typeof ICON_MAP

interface NavLinkProps {
  href: string
  label: string
  iconName: IconName
  badge?: number
  badgeColor?: 'blue' | 'red'
  locked?: boolean
}

export function NavLink({ href, label, iconName, badge, badgeColor = 'blue', locked = false }: NavLinkProps) {
  const pathname = usePathname()
  // Activo exacto para /dashboard, prefijo para el resto
  const isActive = href === '/dashboard' ? pathname === href : pathname.startsWith(href)
  const Icon = ICON_MAP[iconName]

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        locked
          ? 'text-white/30 hover:bg-white/5 hover:text-white/40'
          : isActive
            ? 'bg-white/15 text-white'
            : 'text-white/60 hover:bg-white/10 hover:text-white'
      )}
    >
      <Icon size={18} className={cn(iconName === 'Lightbulb' && !locked ? 'text-amber-300' : '', locked ? 'opacity-40' : '')} />
      <span className="flex-1">{label}</span>
      {locked && <Lock size={12} className="text-white/30" />}
      {!locked && badge != null && badge > 0 && (
        <span className={`${badgeColor === 'red' ? 'bg-red-500' : 'bg-blue-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center`}>
          {badge}
        </span>
      )}
    </Link>
  )
}
