'use client'

// ============================================================
// PatientDetailV2 — Hero + KPIs + Tabs (Historia, Conversaciones, etc.)
// ============================================================

import { useState } from 'react'
import { getInitials } from '@/lib/utils/ui-helpers'
import Link from 'next/link'
import { ChevronRight, Calendar, MessageSquare, Phone, Mail, FileText, StickyNote, User, Plus } from 'lucide-react'
import { ReactivationBanner } from '@/components/dashboard/reactivation-banner'
import { formatPhone, formatTimeForPatient } from '@/lib/utils/dates'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

// ---- Types ----

interface PatientInfo {
  id: string
  name: string
  phone: string
  email: string | null
  document_type: string
  document_number: string | null
  date_of_birth: string | null
  eps: string | null
  notes: string | null
  no_show_count: number
  total_appointments: number
  created_at: string
  visit_frequency_days: number | null
  last_visit_at: string | null
  days_since_last_visit: number | null
}

interface Appointment {
  id: string
  starts_at: string
  status: string
  reason: string | null
  payment_type: string
  documents_requested: boolean
  documents_received: boolean
  doctor_name: string | null
}

interface Conversation {
  id: string
  status: string
  last_message_at: string
  message_count: number
}

interface Props {
  patient: PatientInfo
  appointments: Appointment[]
  conversations: Conversation[]
  topDoctorName: string | null
  conversationId: string | null
  frequencyLabel: string | null
}

type TabKey = 'historia' | 'conversaciones' | 'documentos' | 'notas'

// ---- Helpers ----


const STATUS_MAP: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
  confirmed: { label: 'Proxima', bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)', dot: 'var(--v2-primary)' },
  rescheduled: { label: 'Reagendada', bg: 'var(--v2-amber-soft)', fg: '#b07d00', dot: 'var(--v2-amber)' },
  completed: { label: 'Atendida', bg: 'var(--v2-green-soft)', fg: 'var(--v2-green-deep)', dot: 'var(--v2-green)' },
  no_show: { label: 'No-show', bg: 'var(--v2-amber-soft)', fg: '#b07d00', dot: 'var(--v2-amber)' },
  cancelled: { label: 'Cancelada', bg: 'var(--v2-red-soft)', fg: 'var(--v2-red)', dot: 'var(--v2-red)' },
  blocked_external: { label: 'iSalud', bg: 'var(--v2-primary-soft)', fg: 'var(--v2-primary)', dot: 'var(--v2-primary)' },
}

const CONV_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  active: { label: 'Activa', bg: 'var(--v2-green-soft)', fg: 'var(--v2-green-deep)' },
  escalated: { label: 'Escalada', bg: 'var(--v2-amber-soft)', fg: '#b07d00' },
  resolved: { label: 'Resuelta', bg: 'var(--v2-bg-deeper)', fg: 'var(--v2-text-subtle)' },
}

// ---- Main Component ----

export function PatientDetailV2({ patient, appointments, conversations, topDoctorName, conversationId, frequencyLabel }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('historia')

  const noShowRate = patient.total_appointments > 0
    ? Math.round((patient.no_show_count / patient.total_appointments) * 100)
    : 0
  const assistanceRate = 100 - noShowRate

  const waLink = conversationId
    ? `/dashboard/conversations/${conversationId}`
    : `https://wa.me/${patient.phone.replace('+', '')}?text=Hola%20${encodeURIComponent(patient.name.split(' ')[0])}`

  const TABS: { key: TabKey; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'historia', label: 'Historia', icon: <Calendar size={14} />, count: appointments.length },
    { key: 'conversaciones', label: 'Conversaciones', icon: <MessageSquare size={14} />, count: conversations.length },
    { key: 'documentos', label: 'Documentos', icon: <FileText size={14} />, count: 0 },
    { key: 'notas', label: 'Notas', icon: <StickyNote size={14} />, count: 0 },
  ]

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }} className="space-y-6">
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
        <Link href="/dashboard/patients" style={{ color: 'var(--v2-primary)', fontWeight: 600, textDecoration: 'none' }}>Pacientes</Link>
        <ChevronRight size={14} style={{ color: 'var(--v2-text-subtle)' }} />
        <span style={{ color: 'var(--v2-text-subtle)' }}>{patient.name}</span>
      </div>

      {/* ===== HERO ===== */}
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-xl)',
          boxShadow: 'var(--v2-shadow-sm)',
          padding: '28px',
        }}
      >
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                width: '80px', height: '80px', borderRadius: '24px',
                background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(107, 91, 255, 0.25)',
              }}
            >
              <span style={{ color: '#fff', fontSize: '24px', fontWeight: 800 }}>{getInitials(patient.name)}</span>
            </div>
            <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '16px', height: '16px', borderRadius: '50%', background: 'var(--v2-green)', border: '3px solid var(--v2-bg-card)' }} />
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--v2-text)', letterSpacing: '-0.02em' }}>
              {patient.name}
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>
              {patient.document_type} {patient.document_number ?? 'Sin documento'}
              {patient.date_of_birth && ` · ${format(new Date(patient.date_of_birth + 'T12:00:00'), "d MMM yyyy", { locale: es })}`}
              {' · '}Paciente desde {format(new Date(patient.created_at), "MMM yyyy", { locale: es })}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
              <span className="tag-v2 tag-v2-primary">{patient.eps ?? 'Particular'}</span>
              {patient.total_appointments >= 5 && <span className="tag-v2 tag-v2-green">Paciente leal</span>}
              {patient.no_show_count > 0 && (
                <span className="tag-v2 tag-v2-red">{patient.no_show_count} no-show{patient.no_show_count > 1 ? 's' : ''}</span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '10px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--v2-text-muted)' }}>
                <Phone size={12} /> {formatPhone(patient.phone)}
              </span>
              {patient.email && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--v2-text-muted)' }}>
                  <Mail size={12} /> {patient.email}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            <button
              onClick={() => { window.location.href = `/dashboard/agenda?patientId=${patient.id}` }}
              className="btn-v2-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px', padding: '10px 18px' }}
            >
              <Plus size={14} /> Nueva cita
            </button>
            <a
              href={waLink}
              target={conversationId ? undefined : '_blank'}
              rel={conversationId ? undefined : 'noopener noreferrer'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '10px 18px', borderRadius: 'var(--v2-radius)', fontSize: '13px', fontWeight: 700,
                background: 'var(--v2-whatsapp)', color: '#fff', textDecoration: 'none',
                boxShadow: '0 2px 8px rgba(37,211,102,0.3)', transition: 'all 0.15s',
              }}
            >
              <MessageSquare size={14} /> WhatsApp
            </a>
          </div>
        </div>
      </div>

      {/* Reactivation banner */}
      {patient.total_appointments >= 1 && (
        <ReactivationBanner
          patientId={patient.id}
          visitFrequencyDays={patient.visit_frequency_days}
          daysSinceLastVisit={patient.days_since_last_visit}
          frequencyLabel={frequencyLabel}
        />
      )}

      {/* ===== KPI ROW ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total citas" value={String(patient.total_appointments)} detail={`Desde ${format(new Date(patient.created_at), "MMM yyyy", { locale: es })}`} />
        <KPICard label="Asistencia" value={`${assistanceRate}%`} detail={`${patient.total_appointments - patient.no_show_count} de ${patient.total_appointments}`} valueColor={assistanceRate >= 80 ? 'var(--v2-green)' : 'var(--v2-amber)'} />
        <KPICard label="Doctor frecuente" value={topDoctorName ?? '-'} detail={topDoctorName ? 'Mas citas con' : 'Sin datos'} isText />
        <KPICard label="Ultima visita" value={patient.days_since_last_visit !== null ? `Hace ${patient.days_since_last_visit}d` : '-'} detail={patient.last_visit_at ? format(new Date(patient.last_visit_at), "d MMM yyyy", { locale: es }) : 'Sin visitas'} />
      </div>

      {/* ===== TABS ===== */}
      <div>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '999px', fontSize: '13px',
                fontWeight: activeTab === t.key ? 700 : 500,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                fontFamily: 'var(--font-manrope), sans-serif',
                ...(activeTab === t.key
                  ? { background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)', color: '#fff', boxShadow: '0 2px 6px rgba(107,91,255,0.25)' }
                  : { background: 'var(--v2-bg-soft)', color: 'var(--v2-text-muted)' }),
              }}
            >
              {t.icon} {t.label}
              {t.count > 0 && (
                <span style={{
                  fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px',
                  ...(activeTab === t.key
                    ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                    : { background: 'var(--v2-bg-deeper)', color: 'var(--v2-text-subtle)' }),
                }}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
          {/* Main content */}
          <div>
            {activeTab === 'historia' && <HistoriaTab appointments={appointments} />}
            {activeTab === 'conversaciones' && <ConversacionesTab conversations={conversations} />}
            {activeTab === 'documentos' && <PlaceholderTab icon={<FileText size={32} />} title="Sin documentos guardados" sub="Proximamente podras guardar examenes, recetas y archivos" />}
            {activeTab === 'notas' && <PlaceholderTab icon={<StickyNote size={32} />} title="Sin notas" sub="Proximamente podras agregar notas clinicas" />}
          </div>

          {/* Sidebar */}
          <div className="space-y-4 hidden lg:block">
            {/* Personal info */}
            <SidebarCard title="Informacion personal">
              <InfoRow label="Documento" value={`${patient.document_type} ${patient.document_number ?? '-'}`} />
              <InfoRow label="Nacimiento" value={patient.date_of_birth ? format(new Date(patient.date_of_birth + 'T12:00:00'), "d MMM yyyy", { locale: es }) : '-'} />
              <InfoRow label="EPS" value={patient.eps ?? 'Particular'} />
              <InfoRow label="Email" value={patient.email ?? '-'} />
              {patient.notes && (
                <div style={{ marginTop: '8px', padding: '8px 10px', background: 'var(--v2-bg-soft)', borderRadius: '8px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', fontStyle: 'italic' }}>{patient.notes}</p>
                </div>
              )}
            </SidebarCard>

            {/* Last conversation */}
            {conversations.length > 0 && (
              <SidebarCard title="Ultima conversacion">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>
                    {formatDistanceToNow(new Date(conversations[0].last_message_at), { addSuffix: true, locale: es })}
                  </span>
                  <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: CONV_STATUS[conversations[0].status]?.bg ?? 'var(--v2-bg-soft)', color: CONV_STATUS[conversations[0].status]?.fg ?? 'var(--v2-text-subtle)' }}>
                    {CONV_STATUS[conversations[0].status]?.label ?? conversations[0].status}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>{conversations[0].message_count} mensajes</p>
                {conversationId && (
                  <Link href={`/dashboard/conversations/${conversationId}`} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--v2-primary)', textDecoration: 'none', marginTop: '8px' }}>
                    Abrir chat →
                  </Link>
                )}
              </SidebarCard>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Sub-components ----

function KPICard({ label, value, detail, valueColor, isText }: { label: string; value: string; detail: string; valueColor?: string; isText?: boolean }) {
  return (
    <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', boxShadow: 'var(--v2-shadow-sm)', padding: '18px' }}>
      <p style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--v2-text-subtle)', marginBottom: '4px' }}>{label}</p>
      <p style={{ fontSize: isText ? '15px' : '22px', fontWeight: 800, fontFamily: isText ? 'var(--font-manrope), sans-serif' : 'var(--font-jetbrains), monospace', color: valueColor ?? 'var(--v2-text)', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </p>
      <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', marginTop: '2px' }}>{detail}</p>
    </div>
  )
}

function HistoriaTab({ appointments }: { appointments: Appointment[] }) {
  if (appointments.length === 0) {
    return <PlaceholderTab icon={<Calendar size={32} />} title="Sin citas registradas" sub="Las citas apareceran aqui cuando se agenden" />
  }

  return (
    <div style={{ position: 'relative', paddingLeft: '28px' }}>
      {/* Timeline line */}
      <div style={{ position: 'absolute', left: '7px', top: '8px', bottom: '8px', width: '2px', background: 'linear-gradient(180deg, var(--v2-primary), var(--v2-pink), var(--v2-border-soft))', borderRadius: '1px' }} />

      {appointments.map((a) => {
        const st = STATUS_MAP[a.status] ?? STATUS_MAP.completed
        return (
          <div key={a.id} style={{ position: 'relative', marginBottom: '12px' }}>
            {/* Dot */}
            <div style={{ position: 'absolute', left: '-24px', top: '14px', width: '12px', height: '12px', borderRadius: '50%', background: st.dot, border: '3px solid var(--v2-bg)', zIndex: 1 }} />

            {/* Card */}
            <div
              style={{
                background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)',
                borderRadius: 'var(--v2-radius)', padding: '14px 16px',
                transition: 'box-shadow 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--v2-shadow-sm)' }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text-subtle)', textTransform: 'uppercase' }}>
                  {format(new Date(a.starts_at), "d MMM yyyy", { locale: es })} · {formatTimeForPatient(a.starts_at)}
                </span>
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: st.bg, color: st.fg }}>
                  {st.label}
                </span>
              </div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>{a.reason ?? 'Consulta general'}</p>
              <p style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)', marginTop: '2px' }}>
                {a.doctor_name ?? 'Sin doctor asignado'} &middot; {a.payment_type}
                {a.documents_requested && (
                  <span> &middot; Docs: {a.documents_received ? '✅' : '⏳'}</span>
                )}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ConversacionesTab({ conversations }: { conversations: Conversation[] }) {
  if (conversations.length === 0) {
    return <PlaceholderTab icon={<MessageSquare size={32} />} title="Sin conversaciones" sub="Las conversaciones por WhatsApp apareceran aqui" />
  }

  return (
    <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', overflow: 'hidden' }}>
      {conversations.map((c, idx) => {
        const st = CONV_STATUS[c.status] ?? CONV_STATUS.resolved
        return (
          <Link
            key={c.id}
            href={`/dashboard/conversations/${c.id}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', textDecoration: 'none',
              borderBottom: idx < conversations.length - 1 ? '1px solid var(--v2-border-soft)' : 'none',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: st.bg, color: st.fg }}>{st.label}</span>
              <span style={{ fontSize: '13px', color: 'var(--v2-text-muted)' }}>{c.message_count} mensajes</span>
            </div>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--v2-text-subtle)' }}>
              {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true, locale: es })}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function PlaceholderTab({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ color: 'var(--v2-primary)', opacity: 0.3, margin: '0 auto 12px', display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>{title}</p>
      <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>{sub}</p>
    </div>
  )
}

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius-lg)', boxShadow: 'var(--v2-shadow-sm)', padding: '16px' }}>
      <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--v2-text-subtle)', marginBottom: '10px' }}>{title}</p>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--v2-text)' }}>{value}</span>
    </div>
  )
}
