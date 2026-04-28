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
import { DoctorSelector, getStoredDoctorId, storeDoctorId } from './calendar/doctor-selector'
import { getAppointmentForCalendar } from '@/app/actions/appointments'
import { AppointmentFormModal } from './appointment-form-modal'
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
  const [showNewAptModal, setShowNewAptModal] = useState(false)
  const [newAptPrefill, setNewAptPrefill] = useState<{ date: string; time: string; doctor_id: string } | null>(null)

  const isDoctor = userRole.toLowerCase() === 'doctor' || userRole.toLowerCase() === 'médico'
  const [doctorFilter, setDoctorFilter] = useState<string>(() => {
    return urlDoctor ?? getStoredDoctorId(doctors, restrictDoctorId)
  })

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
    storeDoctorId(id)
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
      const aptId = newApt.id as string
      // Avoid duplicates
      setAppointments((prev) => {
        if (prev.some((a) => a.id === aptId)) return prev
        return prev
      })
      // Fetch full data with patient/doctor joins
      getAppointmentForCalendar(aptId).then((fullApt) => {
        if (fullApt) {
          setAppointments((prev) => {
            if (prev.some((a) => a.id === aptId)) return prev
            return [...prev, fullApt as CalendarAppointment].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          })
        }
      }).catch(() => {
        // Fallback: append with minimal data
        const apt: CalendarAppointment = {
          id: aptId,
          starts_at: newApt.starts_at as string,
          ends_at: newApt.ends_at as string,
          status: newApt.status as string,
          reason: (newApt.reason as string | null) ?? null,
          reminder_24h_sent: false,
          reminder_confirmed: null,
          payment_type: (newApt.payment_type as string) ?? 'Particular',
          doctor_id: (newApt.doctor_id as string | null) ?? null,
          modality: 'presencial',
          virtual_link: null,
          documents_requested: false,
          documents_received: false,
          free_text_reason: null,
          patient: null,
          doctor: doctors.find((d) => d.id === newApt.doctor_id)
            ? { name: doctors.find((d) => d.id === newApt.doctor_id)!.name, specialty: null }
            : null,
        }
        setAppointments((prev) => {
          if (prev.some((a) => a.id === aptId)) return prev
          return [...prev, apt].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        })
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

  function handleEmptySlotClick(date: string, hour: number) {
    setNewAptPrefill({
      date,
      time: `${String(hour).padStart(2, '0')}:00`,
      doctor_id: doctorFilter !== 'all' ? doctorFilter : (doctors[0]?.id ?? ''),
    })
    setShowNewAptModal(true)
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
      {/* ===== Toolbar: [Doctor Selector] [Nav] ... [View Toggle] ===== */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Doctor selector */}
          {doctors.length > 0 && (
            <DoctorSelector
              doctors={doctors}
              selectedId={doctorFilter === 'all' ? (doctors[0]?.id ?? '') : doctorFilter}
              onChange={changeDoctor}
              restrictDoctorId={restrictDoctorId}
            />
          )}

          {/* Date navigation */}
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
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--v2-text)', marginLeft: '4px', textTransform: 'capitalize' }}>
            {getTitle()}
          </h2>
        </div>

        {/* View toggle */}
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

      {/* ===== Status legend (only for single-doctor view) ===== */}
      {doctorFilter !== 'all' && (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 500, color: 'var(--v2-text-subtle)' }}>
          {[
            { label: 'Confirmada', color: '#534AB7' },
            { label: 'Reagendada', color: '#BA7517' },
            { label: 'Completada', color: '#1D9E75' },
            { label: 'No-show', color: '#A32D2D' },
          ].map((s) => (
            <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* ===== Calendar body ===== */}
      {view === 'day' && (
        <DayView
          date={selectedDate}
          todayStr={initialDate}
          appointments={getApptsForDate(toDateStr(selectedDate))}
          expandedApt={expandedApt}
          setExpandedApt={setExpandedApt}
          doctorFilter={doctorFilter}
          doctorName={doctorFilter !== 'all' ? (doctors.find((d) => d.id === doctorFilter)?.name ?? null) : null}
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
          onEmptySlotClick={handleEmptySlotClick}
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

      {/* New appointment modal from empty slot click */}
      <AppointmentFormModal
        isOpen={showNewAptModal}
        onClose={() => { setShowNewAptModal(false); setNewAptPrefill(null) }}
        doctors={doctors as { id: string; name: string; specialty: string | null }[]}
        initialData={newAptPrefill ? {
          id: '',
          patient_id: '',
          patient_name: '',
          doctor_id: newAptPrefill.doctor_id,
          date: newAptPrefill.date,
          time: newAptPrefill.time,
          duration_minutes: 30,
          reason: '',
          payment_type: 'Particular' as const,
          eps_name: '',
        } : undefined}
        onSaved={() => {
          setShowNewAptModal(false)
          setNewAptPrefill(null)
          window.location.reload()
        }}
      />
    </div>
  )
}
