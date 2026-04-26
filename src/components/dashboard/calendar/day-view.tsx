// ============================================================
// DayView v2 — Stat cards + appointment list with inline expand
// ============================================================

import { formatTimeForPatient } from '@/lib/utils/dates'
import { Calendar } from 'lucide-react'
import { AppointmentDetail } from './appointment-detail'
import type { CalendarAppointment } from './types'
import { STATUS_STYLES, STATUS_LABELS, toDateStr, MONTHS_ES } from './types'

interface Props {
  date: Date
  todayStr: string
  appointments: CalendarAppointment[]
  expandedApt: string | null
  setExpandedApt: (id: string | null) => void
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6B5BFF, #8676FF)',
  'linear-gradient(135deg, #FF6BAA, #FF8EC4)',
  'linear-gradient(135deg, #34C77B, #5DD99A)',
  'linear-gradient(135deg, #FFB845, #FFCF7A)',
  'linear-gradient(135deg, #5444E5, #6B5BFF)',
]

function getGradient(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length]
}

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export function DayView({ date, todayStr, appointments, expandedApt, setExpandedApt }: Props) {
  const dateStr = toDateStr(date)
  const isToday = dateStr === todayStr

  const total = appointments.length
  const completed = appointments.filter((a) => a.status === 'completed').length
  const noShows = appointments.filter((a) => a.status === 'no_show').length
  const pending = appointments.filter((a) => a.status === 'confirmed' || a.status === 'rescheduled').length

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }} className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total" value={total} color="var(--v2-text)" />
        <StatCard label="Pendientes" value={pending} color="var(--v2-primary)" />
        <StatCard label="Completadas" value={completed} color="var(--v2-green)" />
        <StatCard label="No-shows" value={noShows} color="var(--v2-red)" />
      </div>

      {/* Appointment list */}
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--v2-border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)' }}>
            Citas {isToday ? 'de hoy' : `del ${date.getDate()} de ${MONTHS_ES[date.getMonth()]}`}
          </h3>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: 'var(--v2-primary-soft)', color: 'var(--v2-primary)' }}>
            {total} cita{total !== 1 ? 's' : ''}
          </span>
        </div>

        {appointments.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <Calendar size={40} style={{ color: 'var(--v2-primary)', opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text-muted)' }}>Dia tranquilo</p>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', marginTop: '4px' }}>
              {isToday ? 'Las citas nuevas apareceran aqui automaticamente' : 'Sin citas agendadas para este dia'}
            </p>
          </div>
        ) : (
          appointments.map((apt) => {
            const patient = apt.patient
            const doctor = apt.doctor
            const isExpanded = expandedApt === apt.id
            const st = STATUS_STYLES[apt.status] ?? STATUS_STYLES.confirmed
            const patientName = patient?.name ?? apt.reason ?? 'Paciente'

            return (
              <div key={apt.id} style={{ borderBottom: '1px solid var(--v2-border-soft)' }}>
                <button
                  onClick={() => setExpandedApt(isExpanded ? null : apt.id)}
                  style={{
                    width: '100%',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 20px',
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                    fontFamily: 'var(--font-manrope), sans-serif',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v2-primary-tint)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Time */}
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-jetbrains), monospace',
                      color: 'var(--v2-text)',
                      width: '70px',
                      flexShrink: 0,
                    }}
                  >
                    {formatTimeForPatient(apt.starts_at)}
                  </span>

                  {/* Avatar */}
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      background: getGradient(patientName),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ color: '#fff', fontSize: '11px', fontWeight: 700 }}>{getInitials(patientName)}</span>
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13.5px', fontWeight: 700, color: apt.status === 'no_show' ? 'var(--v2-text-subtle)' : 'var(--v2-text)', textDecoration: apt.status === 'no_show' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {patientName}
                    </p>
                    {doctor && <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>{doctor.name}</p>}
                  </div>

                  {/* Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, flexWrap: 'wrap' }}>
                    {apt.modality === 'virtual' && <Pill bg="var(--v2-primary-soft)" fg="var(--v2-primary)">Virtual</Pill>}
                    {apt.documents_requested && (
                      <Pill bg={apt.documents_received ? 'var(--v2-green-soft)' : 'var(--v2-amber-soft)'} fg={apt.documents_received ? 'var(--v2-green-deep)' : '#b07d00'}>
                        Docs {apt.documents_received ? 'ok' : '⏳'}
                      </Pill>
                    )}
                    <Pill bg={st.bg} fg={st.fg}>{STATUS_LABELS[apt.status] ?? apt.status}</Pill>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--v2-text-subtle)', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>
                      <path d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <AppointmentDetail appointment={apt} onClose={() => setExpandedApt(null)} />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'var(--v2-bg-card)', border: '1px solid var(--v2-border-soft)', borderRadius: 'var(--v2-radius)', boxShadow: 'var(--v2-shadow-sm)', padding: '14px 16px' }}>
      <p style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--v2-text-subtle)' }}>{label}</p>
      <p style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--font-jetbrains), monospace', color, marginTop: '2px' }}>{value}</p>
    </div>
  )
}

function Pill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: bg, color: fg, whiteSpace: 'nowrap' }}>{children}</span>
}
