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
} as const

type IconName = keyof typeof ICON_MAP

interface NavLinkProps {
  href: string
  label: string
  iconName: IconName
}

export function NavLink({ href, label, iconName }: NavLinkProps) {
  const pathname = usePathname()
  // Activo exacto para /dashboard, prefijo para el resto
  const isActive = href === '/dashboard' ? pathname === href : pathname.startsWith(href)
  const Icon = ICON_MAP[iconName]

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        isActive
          ? 'bg-white/15 text-white'
          : 'text-white/60 hover:bg-white/10 hover:text-white'
      )}
    >
      <Icon size={18} />
      {label}
    </Link>
  )
}
