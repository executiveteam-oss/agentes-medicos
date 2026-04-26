'use client'

// ============================================================
// Dashboard v2 — Componentes de la nueva identidad
// Hero greeting, KPI cards, upcoming appointments, attention needed
// ============================================================

import Link from 'next/link'
import { CalendarDays, TrendingDown, MessageSquare, Clock, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

// ---- Types ----

export interface DashboardKPI {
  label: string
  value: string | number
  detail?: string
  trend?: { value: string; positive: boolean }
  icon: 'calendar' | 'trending-down' | 'message' | 'clock'
  color: 'primary' | 'green' | 'pink' | 'amber'
}

export interface UpcomingAppointment {
  id: string
  startsAt: string      // ISO
  patientName: string
  patientInitials: string
  reason: string | null
  doctorName: string | null
  paymentType: string
  status: string
}

export interface EscalatedConversation {
  id: string
  patientName: string
  patientInitials: string
  lastMessage: string
  timeAgo: string
}

// ---- Hero Greeting ----

export function HeroGreeting({
  firstName,
  dayLine,
  agentActive,
  agentMessages,
}: {
  firstName: string
  dayLine: string
  agentActive: boolean
  agentMessages: number
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1
          className="text-2xl sm:text-3xl font-extrabold"
          style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)', letterSpacing: '-0.02em' }}
        >
          Buenos dias,{' '}
          <span
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontStyle: 'italic',
              fontWeight: 400,
              background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {firstName}
          </span>
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--v2-text-muted)', fontFamily: 'var(--font-manrope), sans-serif' }}>
          {dayLine}
        </p>
      </div>

      {agentActive && (
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl shrink-0"
          style={{
            background: 'var(--v2-bg-card)',
            border: '1px solid var(--v2-border-soft)',
            boxShadow: 'var(--v2-shadow-sm)',
          }}
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--v2-green)' }} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: 'var(--v2-green)' }} />
          </span>
          <span className="text-xs font-semibold" style={{ color: 'var(--v2-text)', fontFamily: 'var(--font-manrope), sans-serif' }}>
            Agente activo
          </span>
          <span className="text-xs" style={{ color: 'var(--v2-text-subtle)' }}>
            &middot; {agentMessages} mensajes hoy
          </span>
        </div>
      )}
    </div>
  )
}

// ---- KPI Card ----

const ICON_MAP = {
  calendar: CalendarDays,
  'trending-down': TrendingDown,
  message: MessageSquare,
  clock: Clock,
}

const COLOR_MAP = {
  primary: { bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)' },
  green: { bg: 'var(--v2-green-soft)', fg: 'var(--v2-green-deep)' },
  pink: { bg: 'var(--v2-pink-soft)', fg: 'var(--v2-pink)' },
  amber: { bg: 'var(--v2-amber-soft)', fg: '#b07d00' },
}

export function KPICard({ kpi }: { kpi: DashboardKPI }) {
  const Icon = ICON_MAP[kpi.icon]
  const colors = COLOR_MAP[kpi.color]

  return (
    <div
      className="p-5 flex flex-col"
      style={{
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        borderRadius: 'var(--v2-radius-lg)',
        boxShadow: 'var(--v2-shadow-sm)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: colors.bg }}
        >
          <Icon size={18} style={{ color: colors.fg }} />
        </div>
        {kpi.trend && (
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: kpi.trend.positive ? 'var(--v2-green-soft)' : 'var(--v2-pink-soft)',
              color: kpi.trend.positive ? 'var(--v2-green-deep)' : 'var(--v2-pink)',
            }}
          >
            {kpi.trend.value}
          </span>
        )}
      </div>
      <p
        className="text-[11.5px] font-semibold uppercase tracking-wider mb-1"
        style={{ color: 'var(--v2-text-subtle)' }}
      >
        {kpi.label}
      </p>
      <p
        className="text-2xl font-extrabold tracking-tight"
        style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)', letterSpacing: '-0.02em' }}
      >
        {kpi.value}
      </p>
      {kpi.detail && (
        <p className="text-[11.5px] font-semibold mt-1" style={{ color: 'var(--v2-text-subtle)' }}>
          {kpi.detail}
        </p>
      )}
    </div>
  )
}

export function KPIRow({ kpis }: { kpis: DashboardKPI[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <KPICard key={kpi.label} kpi={kpi} />
      ))}
    </div>
  )
}

// ---- Upcoming Appointments ----

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  confirmed: { bg: 'var(--v2-green-soft)', fg: 'var(--v2-green-deep)', label: 'Confirmada' },
  rescheduled: { bg: 'var(--v2-amber-soft)', fg: '#b07d00', label: 'Reagendada' },
  completed: { bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)', label: 'Completada' },
  no_show: { bg: 'var(--v2-red-soft)', fg: 'var(--v2-red)', label: 'No-show' },
  blocked_external: { bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)', label: 'iSalud' },
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6B5BFF, #8676FF)',
  'linear-gradient(135deg, #FF6BAA, #FF8EC4)',
  'linear-gradient(135deg, #34C77B, #5DD99A)',
  'linear-gradient(135deg, #FFB845, #FFCF7A)',
  'linear-gradient(135deg, #5444E5, #6B5BFF)',
]

function getAvatarGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

function formatTimeColombia(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true })
}

export function UpcomingAppointmentsList({ appointments }: { appointments: UpcomingAppointment[] }) {
  if (appointments.length === 0) {
    return (
      <SectionCard title="Proximas citas" linkHref="/dashboard" linkLabel="Ver agenda completa">
        <div className="py-12 text-center">
          <p className="text-3xl mb-2">🌿</p>
          <p className="text-sm font-medium" style={{ color: 'var(--v2-text-muted)' }}>
            No hay mas citas por hoy
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--v2-text-subtle)' }}>
            Todo tranquilo por aqui
          </p>
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Proximas citas" linkHref="/dashboard" linkLabel="Ver agenda completa">
      <div>
        {appointments.map((apt, i) => {
          const statusInfo = STATUS_COLORS[apt.status] ?? STATUS_COLORS.confirmed
          return (
            <div
              key={apt.id}
              className="flex items-center gap-3 px-5 py-3.5 transition-colors"
              style={{
                borderBottom: i < appointments.length - 1 ? '1px solid var(--v2-border-soft)' : 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {/* Time */}
              <span
                className="text-[13px] font-bold w-[70px] shrink-0"
                style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text)' }}
              >
                {formatTimeColombia(apt.startsAt)}
              </span>

              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: getAvatarGradient(apt.patientName) }}
              >
                <span className="text-white text-[11px] font-bold">{apt.patientInitials}</span>
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--v2-text)' }}>
                  {apt.patientName}
                </p>
                <p className="text-[11px] truncate" style={{ color: 'var(--v2-text-subtle)' }}>
                  {apt.reason ?? 'Consulta general'}
                  {apt.doctorName && <span> &middot; {apt.doctorName}</span>}
                </p>
              </div>

              {/* Payment tag */}
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{
                  background: apt.paymentType === 'EPS' ? 'var(--v2-primary-soft)' : 'var(--v2-green-soft)',
                  color: apt.paymentType === 'EPS' ? 'var(--v2-primary)' : 'var(--v2-green-deep)',
                }}
              >
                {apt.paymentType}
              </span>

              {/* Status */}
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{ background: statusInfo.bg, color: statusInfo.fg }}
              >
                {statusInfo.label}
              </span>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

// ---- Escalated Conversations ----

function timeAgoText(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  return `hace ${Math.floor(hours / 24)}d`
}

export function EscalatedCard({ conversations }: { conversations: EscalatedConversation[] }) {
  return (
    <SectionCard
      title="Necesitan tu atencion"
      badge={conversations.length > 0 ? conversations.length : undefined}
    >
      {conversations.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-2xl mb-2">✨</p>
          <p className="text-sm font-medium" style={{ color: 'var(--v2-text-muted)' }}>
            Sin escalaciones pendientes
          </p>
        </div>
      ) : (
        <div>
          {conversations.map((conv, i) => (
            <Link
              key={conv.id}
              href={`/dashboard/conversations/${conv.id}`}
              className="flex items-center gap-3 px-5 py-3 transition-colors block"
              style={{
                borderBottom: i < conversations.length - 1 ? '1px solid var(--v2-border-soft)' : 'none',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ background: getAvatarGradient(conv.patientName) }}
              >
                <span className="text-white text-[10px] font-bold">{conv.patientInitials}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--v2-text)' }}>
                  {conv.patientName}
                </p>
                <p className="text-[11px] truncate" style={{ color: 'var(--v2-text-subtle)' }}>
                  {conv.lastMessage}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span
                  className="text-[10px] font-bold"
                  style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text-subtle)' }}
                >
                  {conv.timeAgo}
                </span>
                <div className="mt-0.5">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--v2-amber-soft)', color: '#b07d00' }}
                  >
                    ESC
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ---- Agent Week Stats ----

export function AgentWeekCard({
  messagesResolved,
  avgResponseTime,
  appointmentsBooked,
}: {
  messagesResolved: number
  avgResponseTime: string
  appointmentsBooked: number
}) {
  return (
    <SectionCard title="Agente esta semana" icon={<Sparkles size={14} style={{ color: 'var(--v2-primary)' }} />}>
      <div className="grid grid-cols-3 gap-4 px-5 py-4">
        <div className="text-center">
          <p
            className="text-xl font-extrabold"
            style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-primary)' }}
          >
            {messagesResolved}
          </p>
          <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--v2-text-subtle)' }}>
            Resueltos
          </p>
        </div>
        <div className="text-center">
          <p
            className="text-xl font-extrabold"
            style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-green)' }}
          >
            {avgResponseTime}
          </p>
          <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--v2-text-subtle)' }}>
            Resp. promedio
          </p>
        </div>
        <div className="text-center">
          <p
            className="text-xl font-extrabold"
            style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-pink)' }}
          >
            {appointmentsBooked}
          </p>
          <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--v2-text-subtle)' }}>
            Citas agendadas
          </p>
        </div>
      </div>
    </SectionCard>
  )
}

// ---- Shared Section Card ----

function SectionCard({
  title,
  linkHref,
  linkLabel,
  badge,
  icon,
  children,
}: {
  title: string
  linkHref?: string
  linkLabel?: string
  badge?: number
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      style={{
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        borderRadius: 'var(--v2-radius-lg)',
        boxShadow: 'var(--v2-shadow-sm)',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: '1px solid var(--v2-border-soft)' }}
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3
            className="text-[14px] font-bold"
            style={{ color: 'var(--v2-text)', fontFamily: 'var(--font-manrope), sans-serif' }}
          >
            {title}
          </h3>
          {badge != null && badge > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--v2-pink)', color: '#fff', minWidth: '18px', textAlign: 'center' }}
            >
              {badge}
            </span>
          )}
        </div>
        {linkHref && linkLabel && (
          <Link
            href={linkHref}
            className="text-[12px] font-semibold"
            style={{ color: 'var(--v2-primary)', textDecoration: 'none' }}
          >
            {linkLabel} →
          </Link>
        )}
      </div>
      {children}
    </div>
  )
}
