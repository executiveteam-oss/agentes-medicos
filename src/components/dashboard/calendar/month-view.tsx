// ============================================================
// MonthView v2 — Calendar grid with v2 styling
// TODO: full refactor to v2 when time allows
// ============================================================

import type { CalendarAppointment } from './types'
import { DAYS_ES, DOCTOR_COLORS, toDateStr, getColombiaDateStr } from './types'

interface Props {
  selectedDate: Date
  todayStr: string
  appointments: CalendarAppointment[]
  onDayClick: (d: Date) => void
  doctors: { id: string; name: string }[]
  doctorFilter: string
}

export function MonthView({ selectedDate, todayStr, appointments, onDayClick, doctors, doctorFilter }: Props) {
  const year = selectedDate.getFullYear()
  const month = selectedDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)

  const showingAll = doctorFilter === 'all'
  const doctorColorMap = new Map<string, typeof DOCTOR_COLORS[0]>()
  doctors.forEach((doc, i) => { doctorColorMap.set(doc.id, DOCTOR_COLORS[i % DOCTOR_COLORS.length]) })

  function getApptsForDate(dateStr: string) {
    const filtered = doctorFilter === 'all' ? appointments : appointments.filter((a) => a.doctor_id === doctorFilter)
    return filtered.filter((a) => getColombiaDateStr(a.starts_at) === dateStr)
  }

  return (
    <div
      style={{
        background: 'var(--v2-bg-card)',
        border: '1px solid var(--v2-border-soft)',
        borderRadius: 'var(--v2-radius-lg)',
        boxShadow: 'var(--v2-shadow-sm)',
        overflow: 'hidden',
        fontFamily: 'var(--font-manrope), sans-serif',
      }}
    >
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--v2-border-soft)' }}>
        {DAYS_ES.map((day) => (
          <div key={day} style={{ padding: '10px', textAlign: 'center', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--v2-text-subtle)' }}>{day}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((date, i) => {
          if (!date) return <div key={i} style={{ height: '88px', borderBottom: '1px solid var(--v2-border-soft)', borderRight: '1px solid var(--v2-border-soft)' }} />

          const dateStr = toDateStr(date)
          const isToday = dateStr === todayStr
          const dayAppts = getApptsForDate(dateStr)

          return (
            <button
              key={i}
              onClick={() => onDayClick(date)}
              style={{
                height: '88px',
                borderBottom: '1px solid var(--v2-border-soft)',
                borderRight: '1px solid var(--v2-border-soft)',
                padding: '6px',
                textAlign: 'left',
                background: isToday ? 'var(--v2-primary-tint)' : 'transparent',
                cursor: 'pointer',
                border: 'none',
                borderBottomStyle: 'solid',
                borderBottomWidth: '1px',
                borderBottomColor: 'var(--v2-border-soft)',
                borderRightStyle: 'solid',
                borderRightWidth: '1px',
                borderRightColor: 'var(--v2-border-soft)',
                transition: 'background 0.1s',
                fontFamily: 'var(--font-manrope), sans-serif',
              }}
              onMouseEnter={(e) => { if (!isToday) e.currentTarget.style.background = 'var(--v2-bg-soft)' }}
              onMouseLeave={(e) => { if (!isToday) e.currentTarget.style.background = isToday ? 'var(--v2-primary-tint)' : 'transparent' }}
            >
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  display: isToday ? 'flex' : 'inline',
                  ...(isToday ? {
                    width: '26px', height: '26px', borderRadius: '50%',
                    background: 'var(--v2-primary)', color: '#fff',
                    alignItems: 'center', justifyContent: 'center',
                  } : { color: 'var(--v2-text)' }),
                }}
              >
                {date.getDate()}
              </span>
              {dayAppts.length > 0 && (
                <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {showingAll ? (
                    (() => {
                      const byDoctor = new Map<string, number>()
                      dayAppts.forEach((a) => { byDoctor.set(a.doctor_id ?? 'x', (byDoctor.get(a.doctor_id ?? 'x') ?? 0) + 1) })
                      return Array.from(byDoctor.entries()).slice(0, 3).map(([did, count]) => {
                        const dc = doctorColorMap.get(did)
                        return (
                          <div key={did} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: dc?.dot ?? 'var(--v2-text-subtle)' }} />
                            <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>{count}</span>
                          </div>
                        )
                      })
                    })()
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--v2-primary)' }} />
                      <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>{dayAppts.length}</span>
                    </div>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
