// ============================================================
// WeekView v2 — Grid 7 columns × hours with v2 styling
// ============================================================

import { formatTimeForPatient } from '@/lib/utils/dates'
import { AppointmentDetail } from './appointment-detail'
import type { CalendarAppointment } from './types'
import { DAYS_ES, HOURS, getMonday, getWeekDates, toDateStr, getColombiaDateStr, getColombiaHour, getColombiaMinutes, STATUS_STYLES, DOCTOR_COLORS } from './types'

interface Props {
  selectedDate: Date
  todayStr: string
  appointments: CalendarAppointment[]
  onDayClick: (d: Date) => void
  expandedApt: string | null
  setExpandedApt: (id: string | null) => void
  doctors: { id: string; name: string }[]
  doctorFilter: string
  onEmptySlotClick?: (date: string, hour: number) => void
}

export function WeekView({ selectedDate, todayStr, appointments, onDayClick, expandedApt, setExpandedApt, doctors, doctorFilter, onEmptySlotClick }: Props) {
  const monday = getMonday(selectedDate)
  const weekDates = getWeekDates(monday)
  const showingAll = doctorFilter === 'all'

  // Doctor color map
  const doctorColorMap = new Map<string, typeof DOCTOR_COLORS[0]>()
  doctors.forEach((doc, i) => { doctorColorMap.set(doc.id, DOCTOR_COLORS[i % DOCTOR_COLORS.length]) })

  function getBlockColor(apt: CalendarAppointment): { bg: string; border: string } {
    if (showingAll && apt.doctor_id) {
      const dc = doctorColorMap.get(apt.doctor_id)
      return { bg: dc?.soft ?? 'var(--v2-primary-soft)', border: dc?.dot ?? 'var(--v2-primary)' }
    }
    const st = STATUS_STYLES[apt.status] ?? STATUS_STYLES.confirmed
    return { bg: st.bg, border: st.dot }
  }

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
            const load = dayAppts.length
            return (
              <button
                key={i}
                onClick={() => onDayClick(d)}
                style={{
                  padding: '10px 4px',
                  textAlign: 'center',
                  borderLeft: '1px solid var(--v2-border-soft)',
                  background: isToday ? 'var(--v2-primary-tint)' : 'transparent',
                  cursor: 'pointer',
                  border: 'none',
                  borderLeftStyle: 'solid',
                  borderLeftWidth: '1px',
                  borderLeftColor: 'var(--v2-border-soft)',
                  transition: 'background 0.1s',
                  fontFamily: 'var(--font-manrope), sans-serif',
                }}
                onMouseEnter={(e) => { if (!isToday) e.currentTarget.style.background = 'var(--v2-bg-soft)' }}
                onMouseLeave={(e) => { if (!isToday) e.currentTarget.style.background = 'transparent' }}
              >
                <p style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--v2-text-subtle)' }}>{DAYS_ES[i]}</p>
                <p style={{ fontSize: '18px', fontWeight: 700, color: isToday ? 'var(--v2-primary)' : 'var(--v2-text)', marginTop: '2px' }}>{d.getDate()}</p>
                {load > 0 && (
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', margin: '4px auto 0', background: load >= 8 ? 'var(--v2-pink)' : load <= 2 ? 'var(--v2-green)' : 'var(--v2-amber)' }} />
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
                  const groupCount = hourAppts.length
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
                        if (hourAppts.length === 0 && onEmptySlotClick) {
                          onEmptySlotClick(dateStr, hour)
                        }
                      }}
                    >
                      {/* Empty slot hover label */}
                      {hourAppts.length === 0 && onEmptySlotClick && (
                        <span
                          className="hidden group-hover:flex"
                          style={{
                            position: 'absolute',
                            inset: 0,
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: 'var(--v2-primary)',
                            background: 'var(--v2-primary-tint)',
                            borderRadius: '2px',
                          }}
                        >
                          + Agendar
                        </span>
                      )}
                      {hourAppts.map((apt, aptIdx) => {
                        const colors = getBlockColor(apt)
                        const minutes = getColombiaMinutes(apt.starts_at)
                        const topOffset = (minutes / 60) * 100
                        const patientName = apt.patient?.name ?? apt.reason ?? 'Cita'
                        const widthPct = 100 / groupCount
                        const leftPct = widthPct * aptIdx
                        const isCompact = groupCount >= 2
                        const isVeryCompact = groupCount >= 3
                        return (
                          <button
                            key={apt.id}
                            onClick={() => setExpandedApt(expandedApt === apt.id ? null : apt.id)}
                            style={{
                              position: 'absolute',
                              width: `calc(${widthPct}% - 2px)`,
                              left: `${leftPct}%`,
                              top: `${topOffset}%`,
                              minHeight: '22px',
                              maxHeight: '95%',
                              background: colors.bg,
                              borderRadius: '3px',
                              padding: isCompact ? '1px 3px' : '2px 6px',
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
                              borderRight: aptIdx < groupCount - 1 ? '1px solid rgba(255,255,255,0.7)' : 'none',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--v2-shadow-sm)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
                            title={`${formatTimeForPatient(apt.starts_at)} — ${patientName}`}
                          >
                            <p style={{ fontSize: isVeryCompact ? '8px' : '10px', fontWeight: 700, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                              {isVeryCompact
                                ? (apt.patient?.name ?? 'Cita').split(' ').map((w) => w[0]).join('').slice(0, 3)
                                : `${formatTimeForPatient(apt.starts_at)} ${patientName}`
                              }
                            </p>
                          </button>
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
