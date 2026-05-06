// ============================================================
// WeekView v2 — single-doctor, redesigned appointment cells
// Shows ONE doctor at a time (selected via DoctorSelector)
// ============================================================

import { formatTimeForPatient } from '@/lib/utils/dates'
import { Tooltip } from '@/components/ui/tooltip'
import { AppointmentDetail } from './appointment-detail'
import type { CalendarAppointment } from './types'
import { DAYS_ES, HOURS, getMonday, getWeekDates, toDateStr, getColombiaDateStr, getColombiaHour, getColombiaMinutes, STATUS_LABELS } from './types'

/** Convert "JUAN PEREZ GOMEZ" → "Juan Perez Gomez". Skip if single word <4 chars (sigla). */
function toTitleCase(str: string): string {
  const words = str.trim().split(/\s+/)
  if (words.length === 1 && words[0].length < 4) return str
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

/** Abbreviate long names: "María Fernanda López Gómez" → "María F. López" */
function abbreviateName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length <= 2) return fullName
  // First name + initial of second + last word (likely apellido)
  const first = parts[0]
  const last = parts[parts.length - 1]
  if (parts.length === 3) return `${first} ${parts[1][0]}. ${last}`
  // 4+ words: first + initial second + last
  return `${first} ${parts[1][0]}. ${last}`
}

// Status colors for single-doctor view (redesigned)
const STATUS_CELL_COLORS: Record<string, { bg: string; border: string }> = {
  confirmed:       { bg: '#EEEDFE', border: '#534AB7' },
  rescheduled:     { bg: '#FAEEDA', border: '#BA7517' },
  completed:       { bg: '#E1F5EE', border: '#1D9E75' },
  no_show:         { bg: '#FCEBEB', border: '#A32D2D' },
  blocked_external:{ bg: '#EEEDFE', border: '#534AB7' },
  cancelled:       { bg: '#F4F2FB', border: '#9590A8' },
}

interface Props {
  selectedDate: Date
  todayStr: string
  appointments: CalendarAppointment[]
  onDayClick: (d: Date) => void
  expandedApt: string | null
  setExpandedApt: (id: string | null) => void
  onEmptySlotClick?: (date: string, hour: number) => void
}

export function WeekView({ selectedDate, todayStr, appointments, onDayClick, expandedApt, setExpandedApt, onEmptySlotClick }: Props) {
  const monday = getMonday(selectedDate)
  const weekDates = getWeekDates(monday)

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>
      <div
        style={{
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          overflow: 'hidden',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', borderBottom: '1px solid var(--v2-border-soft)' }}>
          <div style={{ padding: '12px 4px' }} />
          {weekDates.map((d, i) => {
            const dateStr = toDateStr(d)
            const isToday = dateStr === todayStr
            const dayAppts = appointments.filter((a) => getColombiaDateStr(a.starts_at) === dateStr)
            return (
              <button
                key={i}
                onClick={() => onDayClick(d)}
                style={{
                  padding: '10px 4px', textAlign: 'center',
                  borderLeft: '1px solid var(--v2-border-soft)',
                  background: isToday ? 'var(--v2-primary-tint)' : 'transparent',
                  cursor: 'pointer', border: 'none',
                  borderLeftStyle: 'solid', borderLeftWidth: '1px', borderLeftColor: 'var(--v2-border-soft)',
                  transition: 'background 0.1s', fontFamily: 'var(--font-manrope), sans-serif',
                }}
                onMouseEnter={(e) => { if (!isToday) e.currentTarget.style.background = 'var(--v2-bg-soft)' }}
                onMouseLeave={(e) => { if (!isToday) e.currentTarget.style.background = isToday ? 'var(--v2-primary-tint)' : 'transparent' }}
              >
                <p style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--v2-text-subtle)' }}>{DAYS_ES[i]}</p>
                <p style={{ fontSize: '18px', fontWeight: 700, color: isToday ? 'var(--v2-primary)' : 'var(--v2-text)', marginTop: '2px' }}>{d.getDate()}</p>
                {dayAppts.length > 0 && (
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', margin: '4px auto 0', background: dayAppts.length >= 8 ? 'var(--v2-pink)' : dayAppts.length <= 2 ? 'var(--v2-green)' : 'var(--v2-amber)' }} />
                )}
              </button>
            )
          })}
        </div>

        {/* Time grid */}
        <div style={{ overflowY: 'auto', maxHeight: '600px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', position: 'relative' }}>
            {HOURS.map((hour) => (
              <div key={hour} style={{ display: 'contents' }}>
                {/* Hour label */}
                <div style={{ padding: '4px 6px', textAlign: 'right', borderBottom: '1px solid var(--v2-border-soft)', height: '60px' }}>
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-jetbrains), monospace', fontWeight: 500, color: 'var(--v2-text-subtle)' }}>
                    {hour <= 12 ? hour : hour - 12}{hour < 12 ? ' AM' : ' PM'}
                  </span>
                </div>

                {/* Day columns */}
                {weekDates.map((d, colIdx) => {
                  const dateStr = toDateStr(d)
                  const isToday = dateStr === todayStr
                  const hourAppts = appointments.filter((a) =>
                    getColombiaDateStr(a.starts_at) === dateStr && getColombiaHour(a.starts_at) === hour
                  )

                  return (
                    <div
                      key={colIdx}
                      className="group"
                      style={{
                        borderLeft: '1px solid var(--v2-border-soft)',
                        borderBottom: '1px solid var(--v2-border-soft)',
                        height: '60px',
                        position: 'relative',
                        padding: '1px',
                        background: isToday ? 'rgba(107,91,255,0.02)' : 'transparent',
                        cursor: hourAppts.length === 0 && onEmptySlotClick ? 'pointer' : 'default',
                      }}
                      onClick={() => {
                        if (hourAppts.length === 0 && onEmptySlotClick) onEmptySlotClick(dateStr, hour)
                      }}
                    >
                      {/* Empty slot hover */}
                      {hourAppts.length === 0 && onEmptySlotClick && (
                        <span
                          className="hidden group-hover:flex"
                          style={{
                            position: 'absolute', inset: 0,
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: '10px', fontWeight: 600,
                            color: 'var(--v2-primary)', background: 'var(--v2-primary-tint)',
                            borderRadius: '2px',
                          }}
                        >
                          + Agendar
                        </span>
                      )}

                      {/* Appointment cells */}
                      {hourAppts.map((apt) => {
                        const colors = STATUS_CELL_COLORS[apt.status] ?? STATUS_CELL_COLORS.confirmed
                        const minutes = getColombiaMinutes(apt.starts_at)
                        const topPx = minutes // 1 min = 1px (cell is 60px = 60 min)

                        // Calculate duration for height (1 min = 1px, -2px gap between consecutive)
                        const startMs = new Date(apt.starts_at).getTime()
                        const endMs = new Date(apt.ends_at).getTime()
                        const durationMin = Math.round((endMs - startMs) / 60000)
                        const heightPx = Math.max(16, durationMin - 2) // -2px creates visual gap

                        // Patient name: real patients have patient.name, iSalud uses reason
                        const rawName = apt.patient?.name ?? apt.reason ?? 'Sin nombre'
                        const fullName = toTitleCase(rawName)
                        const patientName = abbreviateName(fullName)
                        const consultType = apt.consultation_type_name ?? apt.free_text_reason ?? ''

                        // Content matrix: name ALWAYS visible, hour + type conditional
                        const showHour = durationMin >= 20
                        const showType = durationMin >= 35
                        const fontSize = durationMin < 20 ? '10px' : '11px'

                        const tooltipContent = [
                          fullName,
                          consultType && `Tipo: ${consultType}`,
                          `Estado: ${STATUS_LABELS[apt.status] ?? apt.status}`,
                          apt.payment_type && `Pago: ${apt.payment_type}`,
                          apt.doctor?.name && `Dr. ${apt.doctor.name}`,
                        ].filter(Boolean).join('\n')

                        return (
                          <Tooltip key={apt.id} content={tooltipContent} side="bottom">
                            <button
                              onClick={(e) => { e.stopPropagation(); setExpandedApt(expandedApt === apt.id ? null : apt.id) }}
                              style={{
                                position: 'absolute',
                                left: '2px', right: '2px',
                                top: `${topPx}px`,
                                height: `${heightPx}px`,
                                maxHeight: '95%',
                                background: colors.bg,
                                borderLeft: `3px solid ${colors.border}`,
                                borderRadius: '4px',
                                padding: '3px 6px',
                                cursor: 'pointer',
                                overflow: 'hidden',
                                zIndex: 10,
                                border: 'none',
                                textAlign: 'left',
                                transition: 'box-shadow 0.1s',
                                fontFamily: 'var(--font-manrope), sans-serif',
                                borderLeftStyle: 'solid',
                                borderLeftWidth: '3px',
                                borderLeftColor: colors.border,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
                            >
                              <p style={{ fontSize, fontWeight: 700, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                                {patientName}
                              </p>
                              {showHour && (
                                <p style={{ fontSize: '10px', fontFamily: 'var(--font-jetbrains), monospace', fontWeight: 500, color: colors.border, lineHeight: 1.2, opacity: 0.8 }}>
                                  {formatTimeForPatient(apt.starts_at)}
                                </p>
                              )}
                              {showType && consultType && (
                                <p style={{ fontSize: '10px', color: 'var(--v2-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                                  {consultType}
                                </p>
                              )}
                            </button>
                          </Tooltip>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Expanded detail */}
        {expandedApt && (() => {
          const apt = appointments.find((a) => a.id === expandedApt)
          if (!apt) return null
          return <AppointmentDetail appointment={apt} onClose={() => setExpandedApt(null)} />
        })()}
      </div>
    </div>
  )
}
