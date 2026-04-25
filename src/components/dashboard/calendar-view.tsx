'use client'

// ============================================================
// CalendarView — Vista de calendario con Día / Semana / Mes
// Soporta filtro por doctor y color-coding por doctor/status
// Puro Tailwind, sin librerías externas de calendario
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { formatTimeForPatient, formatDateForPatient, formatPhone } from '@/lib/utils/dates'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { CancelAppointmentButton } from '@/components/dashboard/dashboard-actions'
import { PriorityBadge } from '@/components/dashboard/priority-badge'
import type { PriorityTier } from '@/components/dashboard/priority-badge'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { AppointmentStatus } from '@/types/database'

// ---------- Types ----------

export interface CalendarAppointment {
  id: string
  starts_at: string
  ends_at: string
  status: string
  reason: string | null
  reminder_24h_sent: boolean
  reminder_confirmed: boolean | null
  payment_type: string
  invoice_status: string
  outstanding_balance: number | null
  modality: string
  virtual_link: string | null
  documents_requested: boolean
  documents_received: boolean
  free_text_reason: string | null
  doctor_id: string | null
  patient: {
    id: string
    name: string
    phone: string
    no_show_probability: number
    no_show_count: number
    total_appointments: number
    document_type: string
    document_number: string | null
    date_of_birth: string | null
    doctor_notes: string | null
    data_consent_at: string | null
  } | null
  doctor: {
    name: string
    specialty: string | null
  } | null
}

export interface CalendarDoctor {
  id: string
  name: string
  agenda_closed?: boolean
}

type ViewMode = 'day' | 'week' | 'month'

interface Props {
  appointments: CalendarAppointment[]
  initialDate: string // yyyy-MM-dd in Colombia timezone
  clinicName: string
  doctors: CalendarDoctor[]
  /** Si el usuario es Doctor, restringir a este doctor_id */
  restrictDoctorId?: string | null
  /** Rol del usuario (para mostrar/ocultar tab "Todos") */
  userRole: string
  /** clinic_id para suscripción Realtime */
  clinicId: string
}

// ---------- Constants ----------

const DAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DAYS_FULL_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7) // 7am - 8pm

// Paleta de colores por doctor (se asignan por índice)
const DOCTOR_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-800', dot: 'bg-blue-500' },
  { bg: 'bg-teal-100', border: 'border-teal-300', text: 'text-teal-800', dot: 'bg-teal-500' },
  { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-800', dot: 'bg-purple-500' },
  { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-800', dot: 'bg-orange-500' },
  { bg: 'bg-pink-100', border: 'border-pink-300', text: 'text-pink-800', dot: 'bg-pink-500' },
  { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-800', dot: 'bg-indigo-500' },
]

// Colores por status (usados en vista de doctor individual)
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  confirmed:   { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800' },
  rescheduled: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' },
  completed:   { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800' },
  no_show:     { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800' },
  cancelled:          { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500' },
  blocked_external:   { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800' },
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmada',
  rescheduled: 'Reagendada',
  completed: 'Completada',
  no_show: 'No-show',
  blocked_external: 'iSalud',
  cancelled: 'Cancelada',
}

const PAYMENT_COLORS: Record<string, string> = {
  EPS: 'bg-blue-50 text-blue-700',
  Particular: 'bg-emerald-50 text-emerald-700',
  Póliza: 'bg-purple-50 text-purple-700',
  ARL: 'bg-amber-50 text-amber-700',
}

// ---------- Date helpers ----------

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getColombiaDateStr(iso: string): string {
  const d = new Date(iso)
  const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
  return toDateStr(col)
}

function getColombiaHour(iso: string): number {
  const d = new Date(iso)
  const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
  return col.getUTCHours()
}

function getColombiaMinutes(iso: string): number {
  const d = new Date(iso)
  const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
  return col.getUTCMinutes()
}

function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date
}

function getWeekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
}

// ---------- Main Component ----------

export function CalendarView({ appointments: initialAppointments, initialDate, clinicName, doctors, restrictDoctorId, userRole, clinicId }: Props) {
  const [view, setView] = useState<ViewMode>('week')
  const [selectedDate, setSelectedDate] = useState(parseLocalDate(initialDate))
  const [expandedApt, setExpandedApt] = useState<string | null>(null)

  // Estado local de citas — se actualiza en tiempo real via Supabase Realtime
  const [appointments, setAppointments] = useState<CalendarAppointment[]>(initialAppointments)

  // Sincronizar si el server recarga (navegación)
  const prevInitial = useRef(initialAppointments)
  useEffect(() => {
    if (prevInitial.current !== initialAppointments) {
      setAppointments(initialAppointments)
      prevInitial.current = initialAppointments
    }
  }, [initialAppointments])

  // ----- Supabase Realtime -----
  const handleRealtimeChange = useCallback((payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    new: Record<string, unknown>
    old: Record<string, unknown>
  }) => {
    const { eventType } = payload

    if (eventType === 'DELETE') {
      const oldId = payload.old.id as string
      setAppointments((prev) => prev.filter((a) => a.id !== oldId))
      return
    }

    if (eventType === 'UPDATE') {
      const updated = payload.new
      setAppointments((prev) =>
        prev.map((a) => {
          if (a.id !== updated.id) return a
          // Actualizar campos que pueden cambiar via WhatsApp/dashboard
          return {
            ...a,
            status: (updated.status as string) ?? a.status,
            starts_at: (updated.starts_at as string) ?? a.starts_at,
            ends_at: (updated.ends_at as string) ?? a.ends_at,
            reason: (updated.reason as string | null) ?? a.reason,
            reminder_24h_sent: (updated.reminder_24h_sent as boolean) ?? a.reminder_24h_sent,
            reminder_confirmed: (updated.reminder_confirmed as boolean | null) ?? a.reminder_confirmed,
            payment_type: (updated.payment_type as string) ?? a.payment_type,
            invoice_status: (updated.invoice_status as string) ?? a.invoice_status,
            outstanding_balance: (updated.outstanding_balance as number | null) ?? a.outstanding_balance,
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
      // Evitar duplicados
      setAppointments((prev) => {
        if (prev.some((a) => a.id === newApt.id)) return prev
        // Insertar con datos mínimos (sin relaciones patient/doctor)
        // La información completa se cargará al refrescar la página
        const apt: CalendarAppointment = {
          id: newApt.id as string,
          starts_at: newApt.starts_at as string,
          ends_at: newApt.ends_at as string,
          status: newApt.status as string,
          reason: (newApt.reason as string | null) ?? null,
          reminder_24h_sent: (newApt.reminder_24h_sent as boolean) ?? false,
          reminder_confirmed: (newApt.reminder_confirmed as boolean | null) ?? null,
          payment_type: (newApt.payment_type as string) ?? 'Particular',
          invoice_status: (newApt.invoice_status as string) ?? 'pendiente',
          outstanding_balance: (newApt.outstanding_balance as number | null) ?? null,
          doctor_id: (newApt.doctor_id as string | null) ?? null,
          modality: (newApt.modality as string) ?? 'presencial',
          virtual_link: (newApt.virtual_link as string | null) ?? null,
          documents_requested: (newApt.documents_requested as boolean) ?? false,
          documents_received: (newApt.documents_received as boolean) ?? false,
          free_text_reason: (newApt.free_text_reason as string | null) ?? null,
          patient: null, // Se llenará al refrescar
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `clinic_id=eq.${clinicId}`,
        },
        handleRealtimeChange
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [clinicId, handleRealtimeChange])

  // Doctor filter: 'all' or a specific doctor_id
  const isDoctor = userRole.toLowerCase() === 'doctor' || userRole.toLowerCase() === 'médico'
  const defaultFilter = restrictDoctorId ? restrictDoctorId : 'all'
  const [doctorFilter, setDoctorFilter] = useState<string>(defaultFilter)

  // Build doctor color map
  const doctorColorMap = new Map<string, typeof DOCTOR_COLORS[0]>()
  doctors.forEach((doc, i) => {
    doctorColorMap.set(doc.id, DOCTOR_COLORS[i % DOCTOR_COLORS.length])
  })

  // Filter appointments by selected doctor
  const filteredAppointments = doctorFilter === 'all'
    ? appointments
    : appointments.filter((a) => a.doctor_id === doctorFilter)

  // Whether we're showing all doctors (color by doctor) or single doctor (color by status)
  const showingAllDoctors = doctorFilter === 'all'

  function getAppointmentColors(apt: CalendarAppointment) {
    if (showingAllDoctors && apt.doctor_id) {
      return doctorColorMap.get(apt.doctor_id) ?? DOCTOR_COLORS[0]
    }
    return STATUS_COLORS[apt.status] ?? STATUS_COLORS.confirmed
  }

  function getAppointmentsForDate(dateStr: string): CalendarAppointment[] {
    return filteredAppointments.filter((a) => getColombiaDateStr(a.starts_at) === dateStr)
  }

  function navigate(direction: number) {
    const d = new Date(selectedDate)
    if (view === 'day') d.setDate(d.getDate() + direction)
    else if (view === 'week') d.setDate(d.getDate() + direction * 7)
    else d.setMonth(d.getMonth() + direction)
    setSelectedDate(d)
  }

  function goToday() {
    setSelectedDate(parseLocalDate(initialDate))
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
        return `${monday.getDate()} – ${sunday.getDate()} de ${MONTHS_ES[monday.getMonth()]} ${monday.getFullYear()}`
      }
      return `${monday.getDate()} ${MONTHS_ES[monday.getMonth()].slice(0, 3)} – ${sunday.getDate()} ${MONTHS_ES[sunday.getMonth()].slice(0, 3)} ${sunday.getFullYear()}`
    }
    return `${MONTHS_ES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
  }

  const todayStr = initialDate

  return (
    <div className="space-y-4">
      {/* Doctor filter tabs */}
      {doctors.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tab "Todos" — oculto para rol Doctor */}
          {!isDoctor && (
            <button
              onClick={() => setDoctorFilter('all')}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                doctorFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todos
            </button>
          )}
          {doctors.map((doc, i) => {
            // Si el usuario es Doctor, solo mostrar su propio tab
            if (isDoctor && restrictDoctorId && doc.id !== restrictDoctorId) return null
            const color = DOCTOR_COLORS[i % DOCTOR_COLORS.length]
            const isActive = doctorFilter === doc.id
            return (
              <button
                key={doc.id}
                onClick={() => setDoctorFilter(doc.id)}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  isActive ? 'bg-slate-900 text-white' : doc.agenda_closed ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {doc.agenda_closed ? (
                  <span className="text-xs">🔒</span>
                ) : (
                  <span className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-white' : color.dot}`} />
                )}
                <span className={doc.agenda_closed ? 'line-through' : ''}>{doc.name}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Controls: nav + view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-100 transition-colors" title="Anterior">
            <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => navigate(1)} className="p-2 rounded-lg hover:bg-slate-100 transition-colors" title="Siguiente">
            <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
          <button onClick={goToday} className="text-sm font-medium text-blue-700 hover:text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
            Hoy
          </button>
          <h2 className="text-lg font-semibold text-slate-900 capitalize ml-2">{getTitle()}</h2>
        </div>

        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {v === 'day' ? 'Día' : v === 'week' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      {showingAllDoctors ? (
        <div className="flex gap-4 text-xs font-medium text-slate-500 flex-wrap">
          {doctors.map((doc, i) => {
            const color = DOCTOR_COLORS[i % DOCTOR_COLORS.length]
            return (
              <span key={doc.id} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                {doc.name}
              </span>
            )
          })}
        </div>
      ) : (
        <div className="flex gap-4 text-xs font-medium text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Confirmada</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Reagendada</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Completada</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> No-show</span>
        </div>
      )}

      {/* Calendar body */}
      {view === 'week' && (
        <WeekView
          selectedDate={selectedDate}
          todayStr={todayStr}
          appointments={filteredAppointments}
          onDayClick={(d) => { setSelectedDate(d); setView('day') }}
          expandedApt={expandedApt}
          setExpandedApt={setExpandedApt}
          getColors={getAppointmentColors}
          showDoctorName={showingAllDoctors}
        />
      )}
      {view === 'month' && (
        <MonthView
          selectedDate={selectedDate}
          todayStr={todayStr}
          getAppointmentsForDate={getAppointmentsForDate}
          onDayClick={(d) => { setSelectedDate(d); setView('day') }}
          doctorColorMap={doctorColorMap}
          showingAllDoctors={showingAllDoctors}
        />
      )}
      {view === 'day' && (
        <DayView
          date={selectedDate}
          todayStr={todayStr}
          appointments={getAppointmentsForDate(toDateStr(selectedDate))}
          expandedApt={expandedApt}
          setExpandedApt={setExpandedApt}
          getColors={getAppointmentColors}
          showDoctorName={showingAllDoctors}
        />
      )}
    </div>
  )
}

// ============================================================
// WeekView
// ============================================================

function WeekView({
  selectedDate, todayStr, appointments, onDayClick, expandedApt, setExpandedApt, getColors, showDoctorName,
}: {
  selectedDate: Date
  todayStr: string
  appointments: CalendarAppointment[]
  onDayClick: (d: Date) => void
  expandedApt: string | null
  setExpandedApt: (id: string | null) => void
  getColors: (apt: CalendarAppointment) => { bg: string; border: string; text: string }
  showDoctorName: boolean
}) {
  const monday = getMonday(selectedDate)
  const weekDates = getWeekDates(monday)

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-slate-100">
        <div className="py-3 px-2" />
        {weekDates.map((d, i) => {
          const dateStr = toDateStr(d)
          const isToday = dateStr === todayStr
          return (
            <button key={i} onClick={() => onDayClick(d)}
              className={`py-3 px-2 text-center border-l border-slate-100 hover:bg-slate-50 transition-colors ${isToday ? 'bg-blue-50' : ''}`}>
              <p className="text-xs font-medium text-slate-500 uppercase">{DAYS_ES[i]}</p>
              <p className={`text-lg font-semibold mt-0.5 ${isToday ? 'text-blue-700' : 'text-slate-900'}`}>{d.getDate()}</p>
            </button>
          )
        })}
      </div>

      <div className="overflow-y-auto max-h-[600px]">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          {HOURS.map((hour) => (
            <div key={hour} className="contents">
              <div className="py-2 px-2 text-right border-b border-slate-50 h-16">
                <span className="text-xs text-slate-400 font-medium">
                  {hour <= 12 ? hour : hour - 12}{hour < 12 ? ' AM' : ' PM'}
                </span>
              </div>
              {weekDates.map((d, colIdx) => {
                const dateStr = toDateStr(d)
                const isToday = dateStr === todayStr
                const hourAppts = appointments.filter((a) =>
                  getColombiaDateStr(a.starts_at) === dateStr && getColombiaHour(a.starts_at) === hour
                )
                return (
                  <div key={colIdx} className={`border-l border-b border-slate-50 h-16 relative p-0.5 ${isToday ? 'bg-blue-50/30' : ''}`}>
                    {hourAppts.map((apt) => {
                      const colors = getColors(apt)
                      const minutes = getColombiaMinutes(apt.starts_at)
                      const topOffset = (minutes / 60) * 100
                      return (
                        <button key={apt.id}
                          onClick={() => setExpandedApt(expandedApt === apt.id ? null : apt.id)}
                          className={`absolute left-0.5 right-0.5 ${colors.bg} ${colors.border} border rounded-md px-1 py-0.5 text-left overflow-hidden cursor-pointer hover:shadow-sm transition-shadow z-10`}
                          style={{ top: `${topOffset}%`, minHeight: '20px', maxHeight: '95%' }}
                          title={`${formatTimeForPatient(apt.starts_at)} — ${apt.patient?.name ?? apt.reason ?? 'Paciente'}`}>
                          <p className={`text-[10px] font-bold ${colors.text} truncate leading-tight`}>
                            {formatTimeForPatient(apt.starts_at)} — {apt.patient?.name ?? apt.reason ?? 'Paciente'}
                          </p>
                          {showDoctorName && apt.doctor && (
                            <p className={`text-[9px] ${colors.text} opacity-70 truncate leading-tight`}>{apt.doctor.name}</p>
                          )}
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

      {expandedApt && <AppointmentDetail appointment={appointments.find((a) => a.id === expandedApt) ?? null} onClose={() => setExpandedApt(null)} />}
    </div>
  )
}

// ============================================================
// MonthView
// ============================================================

function MonthView({
  selectedDate, todayStr, getAppointmentsForDate, onDayClick, doctorColorMap, showingAllDoctors,
}: {
  selectedDate: Date
  todayStr: string
  getAppointmentsForDate: (dateStr: string) => CalendarAppointment[]
  onDayClick: (d: Date) => void
  doctorColorMap: Map<string, typeof DOCTOR_COLORS[0]>
  showingAllDoctors: boolean
}) {
  const year = selectedDate.getFullYear()
  const month = selectedDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-100">
        {DAYS_ES.map((day) => (
          <div key={day} className="py-2 text-center text-xs font-medium text-slate-500 uppercase">{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="h-24 border-b border-r border-slate-50" />
          const dateStr = toDateStr(date)
          const isToday = dateStr === todayStr
          const dayAppts = getAppointmentsForDate(dateStr)

          return (
            <button key={i} onClick={() => onDayClick(date)}
              className={`h-24 border-b border-r border-slate-50 p-1.5 text-left hover:bg-slate-50 transition-colors ${isToday ? 'bg-blue-50/50' : ''}`}>
              <span className={`text-sm font-medium ${isToday ? 'bg-blue-700 text-white w-7 h-7 rounded-full flex items-center justify-center' : 'text-slate-700'}`}>
                {date.getDate()}
              </span>
              {dayAppts.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {showingAllDoctors ? (
                    // Group by doctor and show colored dots
                    (() => {
                      const byDoctor = new Map<string, number>()
                      dayAppts.forEach((a) => {
                        const did = a.doctor_id ?? 'unknown'
                        byDoctor.set(did, (byDoctor.get(did) ?? 0) + 1)
                      })
                      return Array.from(byDoctor.entries()).slice(0, 3).map(([did, count]) => {
                        const color = doctorColorMap.get(did)
                        return (
                          <div key={did} className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${color?.dot ?? 'bg-slate-400'}`} />
                            <span className={`text-[10px] ${color?.text ?? 'text-slate-600'} font-medium`}>{count}</span>
                          </div>
                        )
                      })
                    })()
                  ) : (
                    // Group by status
                    (() => {
                      const pending = dayAppts.filter((a) => a.status === 'confirmed' || a.status === 'rescheduled').length
                      const completed = dayAppts.filter((a) => a.status === 'completed').length
                      const noShow = dayAppts.filter((a) => a.status === 'no_show').length
                      return (
                        <>
                          {pending > 0 && <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" /><span className="text-[10px] text-blue-700 font-medium">{pending}</span></div>}
                          {completed > 0 && <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /><span className="text-[10px] text-emerald-700 font-medium">{completed}</span></div>}
                          {noShow > 0 && <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /><span className="text-[10px] text-red-700 font-medium">{noShow}</span></div>}
                        </>
                      )
                    })()
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

// ============================================================
// DayView
// ============================================================

function DayView({
  date, todayStr, appointments, expandedApt, setExpandedApt, getColors, showDoctorName,
}: {
  date: Date
  todayStr: string
  appointments: CalendarAppointment[]
  expandedApt: string | null
  setExpandedApt: (id: string | null) => void
  getColors: (apt: CalendarAppointment) => { bg: string; border: string; text: string }
  showDoctorName: boolean
}) {
  const dateStr = toDateStr(date)
  const isToday = dateStr === todayStr

  const total = appointments.length
  const completed = appointments.filter((a) => a.status === 'completed').length
  const noShows = appointments.filter((a) => a.status === 'no_show').length
  const pending = appointments.filter((a) => a.status === 'confirmed' || a.status === 'rescheduled').length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total</p>
          <p className="text-xl font-semibold text-slate-900 mt-1">{total}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pendientes</p>
          <p className="text-xl font-semibold text-blue-700 mt-1">{pending}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Completadas</p>
          <p className="text-xl font-semibold text-emerald-700 mt-1">{completed}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">No-shows</p>
          <p className="text-xl font-semibold text-red-600 mt-1">{noShows}</p>
        </div>
      </div>

      <div className="card divide-y divide-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Citas {isToday ? 'de hoy' : `del ${date.getDate()} de ${MONTHS_ES[date.getMonth()]}`}
          </h3>
          <span className="badge badge-blue">{total} cita{total !== 1 ? 's' : ''}</span>
        </div>

        {appointments.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-slate-900 font-medium mb-1">No hay citas agendadas</p>
            <p className="text-slate-500 text-sm">
              {isToday ? 'Las citas nuevas aparecerán aquí automáticamente' : 'No se encontraron citas para este día'}
            </p>
          </div>
        ) : (
          appointments.map((apt) => {
            const patient = apt.patient
            const doctor = apt.doctor
            const isExpanded = expandedApt === apt.id
            const colors = getColors(apt)
            const probability = patient?.no_show_probability ?? 0

            let dotColor = 'bg-blue-500'
            if (apt.status === 'completed') dotColor = 'bg-emerald-500'
            else if (apt.status === 'no_show') dotColor = 'bg-red-500'
            else if (apt.status === 'rescheduled') dotColor = 'bg-amber-400'
            else if (apt.reminder_confirmed === true) dotColor = 'bg-emerald-500'
            else if (probability > 40) dotColor = 'bg-red-500'

            return (
              <div key={apt.id} className={apt.status === 'completed' ? 'bg-emerald-50/50' : apt.status === 'no_show' ? 'bg-red-50/50' : ''}>
                <button
                  onClick={() => setExpandedApt(isExpanded ? null : apt.id)}
                  className="w-full cursor-pointer flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${dotColor} flex-shrink-0`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-sm">{formatTimeForPatient(apt.starts_at)}</span>
                        <span className="text-slate-300">—</span>
                        <span className={`text-slate-700 text-sm font-medium ${apt.status === 'no_show' ? 'line-through text-slate-400' : ''}`}>
                          {patient?.name ?? apt.reason ?? 'Paciente'}
                        </span>
                      </div>
                      {doctor && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {showDoctorName && <span className={`${colors.text} font-medium`}>{doctor.name}</span>}
                          {!showDoctorName && doctor.name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {apt.modality === 'virtual' && (
                      <span className="badge bg-violet-50 text-violet-700 border-violet-200 border">Virtual</span>
                    )}
                    {apt.documents_requested && (
                      apt.documents_received
                        ? <span className="badge bg-green-50 text-green-700 border-green-200 border">Docs ok</span>
                        : <span className="badge bg-amber-50 text-amber-700 border-amber-200 border">Docs pendientes</span>
                    )}
                    <span className={`badge ${PAYMENT_COLORS[apt.payment_type] ?? 'badge-slate'}`}>{apt.payment_type}</span>
                    <span className={`badge ${colors.bg} ${colors.text} ${colors.border} border`}>{STATUS_LABELS[apt.status] ?? apt.status}</span>
                    {probability > 0 && apt.status !== 'completed' && apt.status !== 'no_show' && (
                      <span className={`text-xs font-medium ${probability > 40 ? 'text-red-600' : 'text-slate-400'}`}>{probability}%</span>
                    )}
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isExpanded && patient && (
                  <div className="px-5 pb-5 pt-2 bg-slate-50/50">
                    {/* Prominent time header */}
                    <div className="mb-4 pb-3 border-b border-slate-200">
                      <p className="text-base font-bold text-slate-900 capitalize">
                        {formatDateForPatient(apt.starts_at)} · {formatTimeForPatient(apt.starts_at)} — {formatTimeForPatient(apt.ends_at)}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        {doctor && <span className="text-sm text-slate-600 font-medium">{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ''}</span>}
                        {apt.reason && <span className="text-sm text-slate-400">· {apt.reason}</span>}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                      <DetailItem label="Teléfono" value={formatPhone(patient.phone)} />
                      <DetailItem label="Documento" value={`${patient.document_type} ${patient.document_number ?? 'No registrado'}`} />
                      <DetailItem label="Fecha nacimiento" value={patient.date_of_birth ?? 'No registrada'} />
                      <DetailItem label="Doctor" value={doctor?.name ?? '-'} />
                      <DetailItem label="Motivo" value={apt.reason ?? 'No especificado'} />
                      <DetailItem label="Recordatorio"
                        value={apt.reminder_confirmed === true ? 'Confirmó' : apt.reminder_confirmed === false ? 'No confirmó' : apt.reminder_24h_sent ? 'Enviado, sin respuesta' : 'No enviado'}
                        valueClass={apt.reminder_confirmed === true ? 'text-emerald-600' : apt.reminder_confirmed === false ? 'text-red-600' : undefined}
                      />
                      <DetailItem label="Historial" value={`${patient.total_appointments} citas, ${patient.no_show_count} no-shows`} />
                      <DetailItem label="Riesgo no-show" value={`${probability}%`}
                        valueClass={probability > 40 ? 'text-red-600' : probability > 20 ? 'text-amber-600' : 'text-emerald-600'}
                      />
                    </div>
                    {apt.free_text_reason && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <p className="text-xs font-medium uppercase tracking-wider text-blue-600 mb-1">📋 Motivo del paciente</p>
                        <p className="text-slate-700 text-sm">{apt.free_text_reason}</p>
                      </div>
                    )}
                    {patient.doctor_notes && (
                      <div className="mt-3 p-3 bg-white rounded-lg border border-slate-100">
                        <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">Notas del doctor</p>
                        <p className="text-slate-700 text-sm">{patient.doctor_notes}</p>
                      </div>
                    )}
                    <QuickActions appointmentId={apt.id} currentStatus={apt.status as AppointmentStatus} />
                    {(apt.status === 'confirmed' || apt.status === 'rescheduled') && (
                      <CancelAppointmentButton appointmentId={apt.id} />
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ============================================================
// AppointmentDetail — Panel from week view click
// ============================================================

function getPatientPriorityTier(patient: CalendarAppointment['patient']): PriorityTier | null {
  if (!patient) return null
  let score = 0
  if (patient.total_appointments >= 5) score += 25
  else if (patient.total_appointments >= 2) score += 15
  if (patient.no_show_count === 0) score += 20
  else if (patient.no_show_count === 1) score += 5
  else score -= 10
  // Approximate: assume mid-range for payment (+20) since we don't have payment_type here
  score += 20
  if (score >= 80) return 'high'
  if (score >= 50) return 'mid'
  return null
}

function AppointmentDetail({ appointment, onClose }: { appointment: CalendarAppointment | null; onClose: () => void }) {
  if (!appointment) return null
  const apt = appointment
  const patient = apt.patient
  const doctor = apt.doctor
  const statusColors = STATUS_COLORS[apt.status] ?? STATUS_COLORS.confirmed
  const priorityTier = getPatientPriorityTier(patient)

  return (
    <div className="border-t border-slate-100 px-5 py-4 bg-slate-50">
      {/* Prominent time header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-base font-bold text-slate-900 capitalize">
            {formatDateForPatient(apt.starts_at)} · {formatTimeForPatient(apt.starts_at)} — {formatTimeForPatient(apt.ends_at)}
          </p>
          <div className="flex items-center gap-3 mt-1.5">
            {doctor && <span className="text-sm text-slate-600 font-medium">{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ''}</span>}
            <span className="text-sm text-slate-400">|</span>
            <span className="text-sm text-slate-700 font-medium">{patient?.name ?? apt.reason ?? 'Paciente'}</span>
            {priorityTier && <PriorityBadge tier={priorityTier} size="xs" />}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`badge ${statusColors.bg} ${statusColors.text} ${statusColors.border} border`}>{STATUS_LABELS[apt.status] ?? apt.status}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      {patient && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <DetailItem label="Teléfono" value={formatPhone(patient.phone)} />
          <DetailItem label="Motivo" value={apt.reason ?? 'No especificado'} />
          <DetailItem label="Tipo pago" value={apt.payment_type} />
          <DetailItem label="Historial" value={`${patient.total_appointments} citas, ${patient.no_show_count} no-shows`} />
          {apt.modality === 'virtual' && (
            <DetailItem label="Modalidad" value="Virtual" valueClass="text-violet-700 font-medium" />
          )}
          {apt.documents_requested && (
            <DetailItem
              label="Documentos"
              value={apt.documents_received ? 'Recibidos' : 'Pendientes'}
              valueClass={apt.documents_received ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}
            />
          )}
        </div>
      )}
      {apt.modality === 'virtual' && apt.virtual_link && (
        <div className="mt-2 flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
          <span className="text-xs text-violet-700 font-medium shrink-0">Link:</span>
          <a href={apt.virtual_link} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-700 underline truncate">{apt.virtual_link}</a>
          <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(apt.virtual_link!) }}
            className="text-xs text-violet-500 hover:text-violet-700 shrink-0 ml-auto"
            title="Copiar link"
          >
            Copiar
          </button>
        </div>
      )}
      <div className="mt-3">
        <QuickActions appointmentId={apt.id} currentStatus={apt.status as AppointmentStatus} />
        {(apt.status === 'confirmed' || apt.status === 'rescheduled') && (
          <CancelAppointmentButton appointmentId={apt.id} />
        )}
      </div>
    </div>
  )
}

// ============================================================
// Shared sub-components
// ============================================================

function DetailItem({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${valueClass ?? 'text-slate-700'}`}>{value}</p>
    </div>
  )
}
