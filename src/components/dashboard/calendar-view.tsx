'use client'

// ============================================================
// CalendarView v2 — Orchestrator with URL state + keyboard shortcuts
// Sub-components: calendar/day-view, week-view, month-view
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { DayView } from './calendar/day-view'
import { WeekView } from './calendar/week-view'
import { MonthView } from './calendar/month-view'
import type { CalendarAppointment, CalendarDoctor, ViewMode } from './calendar/types'
import { parseLocalDate, toDateStr, getColombiaDateStr, DAYS_FULL_ES, MONTHS_ES, getMonday, DOCTOR_COLORS } from './calendar/types'

// Re-export types for page.tsx imports
export type { CalendarAppointment, CalendarDoctor }

interface Props {
  appointments: CalendarAppointment[]
  initialDate: string
  clinicName: string
  doctors: CalendarDoctor[]
  restrictDoctorId?: string | null
  userRole: string
  clinicId: string
}

export function CalendarView({ appointments: initialAppointments, initialDate, clinicName, doctors, restrictDoctorId, userRole, clinicId }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL state
  const urlView = searchParams.get('view') as ViewMode | null
  const urlDate = searchParams.get('date')
  const urlDoctor = searchParams.get('doctor')

  const [view, setView] = useState<ViewMode>(urlView && ['day', 'week', 'month'].includes(urlView) ? urlView : 'week')
  const [selectedDate, setSelectedDate] = useState(urlDate ? parseLocalDate(urlDate) : parseLocalDate(initialDate))
  const [expandedApt, setExpandedApt] = useState<string | null>(null)
  const [appointments, setAppointments] = useState(initialAppointments)

  const isDoctor = userRole.toLowerCase() === 'doctor' || userRole.toLowerCase() === 'médico'
  const defaultFilter = restrictDoctorId ? restrictDoctorId : 'all'
  const [doctorFilter, setDoctorFilter] = useState<string>(urlDoctor ?? defaultFilter)

  // Sync with server on navigation
  const prevInitial = useRef(initialAppointments)
  useEffect(() => {
    if (prevInitial.current !== initialAppointments) {
      setAppointments(initialAppointments)
      prevInitial.current = initialAppointments
    }
  }, [initialAppointments])

  // ---- URL sync ----
  function updateURL(newView: ViewMode, newDate: Date, newDoctor: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', newView)
    params.set('date', toDateStr(newDate))
    if (newDoctor !== 'all') params.set('doctor', newDoctor)
    else params.delete('doctor')
    // Keep patientId if present
    router.replace(`/dashboard/agenda?${params.toString()}`, { scroll: false })
  }

  function changeView(v: ViewMode) {
    setView(v)
    updateURL(v, selectedDate, doctorFilter)
  }

  function changeDate(d: Date) {
    setSelectedDate(d)
    updateURL(view, d, doctorFilter)
  }

  function changeDoctor(id: string) {
    setDoctorFilter(id)
    updateURL(view, selectedDate, id)
  }

  // ---- Realtime ----
  const handleRealtimeChange = useCallback((payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    new: Record<string, unknown>
    old: Record<string, unknown>
  }) => {
    const { eventType } = payload

    if (eventType === 'DELETE') {
      setAppointments((prev) => prev.filter((a) => a.id !== payload.old.id))
      return
    }

    if (eventType === 'UPDATE') {
      const updated = payload.new
      setAppointments((prev) =>
        prev.map((a) => {
          if (a.id !== updated.id) return a
          return {
            ...a,
            status: (updated.status as string) ?? a.status,
            starts_at: (updated.starts_at as string) ?? a.starts_at,
            ends_at: (updated.ends_at as string) ?? a.ends_at,
            reason: (updated.reason as string | null) ?? a.reason,
            reminder_24h_sent: (updated.reminder_24h_sent as boolean) ?? a.reminder_24h_sent,
            reminder_confirmed: (updated.reminder_confirmed as boolean | null) ?? a.reminder_confirmed,
            payment_type: (updated.payment_type as string) ?? a.payment_type,
            doctor_id: (updated.doctor_id as string | null) ?? a.doctor_id,
            modality: (updated.modality as string) ?? a.modality,
            virtual_link: (updated.virtual_link as string | null) ?? a.virtual_link,
            documents_requested: (updated.documents_requested as boolean) ?? a.documents_requested,
            documents_received: (updated.documents_received as boolean) ?? a.documents_received,
          }
        })
      )
      return
    }

    if (eventType === 'INSERT') {
      const newApt = payload.new
      setAppointments((prev) => {
        if (prev.some((a) => a.id === newApt.id)) return prev
        const apt: CalendarAppointment = {
          id: newApt.id as string,
          starts_at: newApt.starts_at as string,
          ends_at: newApt.ends_at as string,
          status: newApt.status as string,
          reason: (newApt.reason as string | null) ?? null,
          reminder_24h_sent: (newApt.reminder_24h_sent as boolean) ?? false,
          reminder_confirmed: (newApt.reminder_confirmed as boolean | null) ?? null,
          payment_type: (newApt.payment_type as string) ?? 'Particular',
          doctor_id: (newApt.doctor_id as string | null) ?? null,
          modality: (newApt.modality as string) ?? 'presencial',
          virtual_link: (newApt.virtual_link as string | null) ?? null,
          documents_requested: (newApt.documents_requested as boolean) ?? false,
          documents_received: (newApt.documents_received as boolean) ?? false,
          free_text_reason: (newApt.free_text_reason as string | null) ?? null,
          patient: null,
          doctor: doctors.find((d) => d.id === newApt.doctor_id)
            ? { name: doctors.find((d) => d.id === newApt.doctor_id)!.name, specialty: null }
            : null,
        }
        return [...prev, apt].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      })
    }
  }, [doctors])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel('appointments-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${clinicId}` }, handleRealtimeChange)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [clinicId, handleRealtimeChange])

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'h' || e.key === 't') { changeDate(parseLocalDate(initialDate)); return }
      if (e.key === 'd') { changeView('day'); return }
      if (e.key === 'w') { changeView('week'); return }
      if (e.key === 'm') { changeView('month'); return }
      if (e.key === 'Escape') { setExpandedApt(null); return }
      if (e.key === 'ArrowLeft') { navigate(-1); return }
      if (e.key === 'ArrowRight') { navigate(1); return }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  // ---- Navigation ----
  function navigate(direction: number) {
    const d = new Date(selectedDate)
    if (view === 'day') d.setDate(d.getDate() + direction)
    else if (view === 'week') d.setDate(d.getDate() + direction * 7)
    else d.setMonth(d.getMonth() + direction)
    changeDate(d)
  }

  function goToday() {
    changeDate(parseLocalDate(initialDate))
  }

  function getTitle(): string {
    if (view === 'day') {
      const dayIdx = selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1
      return `${DAYS_FULL_ES[dayIdx]} ${selectedDate.getDate()} de ${MONTHS_ES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
    }
    if (view === 'week') {
      const monday = getMonday(selectedDate)
      const sunday = new Date(monday)
      sunday.setDate(sunday.getDate() + 6)
      if (monday.getMonth() === sunday.getMonth()) {
        return `${monday.getDate()} — ${sunday.getDate()} de ${MONTHS_ES[monday.getMonth()]} ${monday.getFullYear()}`
      }
      return `${monday.getDate()} ${MONTHS_ES[monday.getMonth()].slice(0, 3)} — ${sunday.getDate()} ${MONTHS_ES[sunday.getMonth()].slice(0, 3)} ${sunday.getFullYear()}`
    }
    return `${MONTHS_ES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
  }

  // ---- Filter appointments ----
  const filteredAppointments = doctorFilter === 'all'
    ? appointments
    : appointments.filter((a) => a.doctor_id === doctorFilter)

  function getApptsForDate(dateStr: string): CalendarAppointment[] {
    return filteredAppointments.filter((a) => getColombiaDateStr(a.starts_at) === dateStr)
  }

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }} className="space-y-4">
      {/* ===== Doctor filter ===== */}
      {doctors.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {!isDoctor && (
            <button
              onClick={() => changeDoctor('all')}
              style={{
                padding: '6px 14px', borderRadius: '999px', fontSize: '12.5px',
                fontWeight: doctorFilter === 'all' ? 700 : 500, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-manrope), sans-serif', transition: 'all 0.15s',
                ...(doctorFilter === 'all'
                  ? { background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)', color: '#fff', boxShadow: '0 2px 6px rgba(107,91,255,0.25)' }
                  : { background: 'var(--v2-bg-soft)', color: 'var(--v2-text-muted)' }),
              }}
            >
              Todos
            </button>
          )}
          {doctors.map((doc, i) => {
            if (isDoctor && restrictDoctorId && doc.id !== restrictDoctorId) return null
            const isActive = doctorFilter === doc.id
            const dc = DOCTOR_COLORS[i % DOCTOR_COLORS.length]
            return (
              <button
                key={doc.id}
                onClick={() => changeDoctor(doc.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 14px', borderRadius: '999px', fontSize: '12.5px',
                  fontWeight: isActive ? 700 : 500, border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-manrope), sans-serif', transition: 'all 0.15s',
                  ...(isActive
                    ? { background: 'linear-gradient(135deg, var(--v2-primary), #8676FF)', color: '#fff', boxShadow: '0 2px 6px rgba(107,91,255,0.25)' }
                    : { background: 'var(--v2-bg-soft)', color: doc.agenda_closed ? 'var(--v2-text-subtle)' : 'var(--v2-text-muted)' }),
                  textDecoration: doc.agenda_closed ? 'line-through' : 'none',
                }}
              >
                {doc.agenda_closed ? '🔒' : <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isActive ? '#fff' : dc.dot }} />}
                {doc.name}
              </button>
            )
          })}
        </div>
      )}

      {/* ===== Controls: nav + view toggle ===== */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--v2-text-muted)', borderRadius: '8px' }} title="Anterior">
            <ChevronLeft size={20} />
          </button>
          <button onClick={() => navigate(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--v2-text-muted)', borderRadius: '8px' }} title="Siguiente">
            <ChevronRight size={20} />
          </button>
          <button
            onClick={goToday}
            style={{
              fontSize: '12px', fontWeight: 600, padding: '5px 12px', borderRadius: '8px',
              border: '1px solid var(--v2-border)', background: 'var(--v2-bg-card)', color: 'var(--v2-primary)',
              cursor: 'pointer', fontFamily: 'var(--font-manrope), sans-serif',
            }}
          >
            Hoy
          </button>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--v2-text)', marginLeft: '8px', textTransform: 'capitalize' }}>
            {getTitle()}
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '2px', padding: '3px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-bg-soft)' }}>
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => changeView(v)}
              style={{
                padding: '5px 14px', borderRadius: '8px', fontSize: '12px',
                fontWeight: view === v ? 700 : 500, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-manrope), sans-serif', transition: 'all 0.15s',
                ...(view === v
                  ? { background: 'var(--v2-bg-card)', color: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-sm)' }
                  : { background: 'transparent', color: 'var(--v2-text-muted)' }),
              }}
            >
              {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
      </div>

      {/* ===== Legend ===== */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 500, color: 'var(--v2-text-subtle)' }}>
        {doctorFilter === 'all'
          ? doctors.map((doc, i) => {
              const dc = DOCTOR_COLORS[i % DOCTOR_COLORS.length]
              return (
                <span key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: dc.dot }} />
                  {doc.name}
                </span>
              )
            })
          : [
              { label: 'Confirmada', color: 'var(--v2-primary)' },
              { label: 'Reagendada', color: 'var(--v2-amber)' },
              { label: 'Completada', color: 'var(--v2-green)' },
              { label: 'No-show', color: 'var(--v2-red)' },
            ].map((s) => (
              <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color }} />
                {s.label}
              </span>
            ))
        }
      </div>

      {/* ===== Calendar body ===== */}
      {view === 'day' && (
        <DayView
          date={selectedDate}
          todayStr={initialDate}
          appointments={getApptsForDate(toDateStr(selectedDate))}
          expandedApt={expandedApt}
          setExpandedApt={setExpandedApt}
        />
      )}
      {view === 'week' && (
        <WeekView
          selectedDate={selectedDate}
          todayStr={initialDate}
          appointments={filteredAppointments}
          onDayClick={(d) => { setSelectedDate(d); changeView('day') }}
          expandedApt={expandedApt}
          setExpandedApt={setExpandedApt}
          doctors={doctors}
          doctorFilter={doctorFilter}
        />
      )}
      {view === 'month' && (
        <MonthView
          selectedDate={selectedDate}
          todayStr={initialDate}
          appointments={appointments}
          onDayClick={(d) => { setSelectedDate(d); changeView('day') }}
          doctors={doctors}
          doctorFilter={doctorFilter}
        />
      )}
    </div>
  )
}
