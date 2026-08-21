'use client'

// ============================================================
// CalendarView v2 — Orchestrator with URL state + keyboard shortcuts
// Sub-components: calendar/day-view, week-view, month-view
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { DayView } from './calendar/day-view'
import { WeekView } from './calendar/week-view'
import { MonthView } from './calendar/month-view'
import { DoctorSelector, getStoredDoctorId, storeDoctorId } from './calendar/doctor-selector'
import { getAppointmentForCalendar } from '@/app/actions/appointments'
import type { OpcionServicio } from '@/lib/consultation-types/opciones-agendamiento'
import { AppointmentFormModal } from './appointment-form-modal'
import type { CalendarAppointment, CalendarDoctor, ViewMode } from './calendar/types'
import { parseLocalDate, toDateStr, getColombiaDateStr, getColombiaHour, getColombiaMinutes, DAYS_FULL_ES, MONTHS_ES, getMonday, DOCTOR_COLORS, CONFIRMO, NO_CONFIRMO } from './calendar/types'
import { ConfirmarFueraHorarioModal } from './calendar/confirmar-fuera-horario-modal'
import type { DisponibilidadDelDia, EstadoFranja } from '@/lib/calendar/day-availability'
import { getDisponibilidadAgenda } from '@/app/actions/availability'
import { getBloqueosDeAgenda } from '@/app/actions/blocked-dates'

// Re-export types for page.tsx imports
export type { CalendarAppointment, CalendarDoctor }

export interface SurveyConfigForCalendar {
  enabled: boolean
  form_url: string | null
  clinic_display_name: string
  /** Hay config guardada pero mal formada. Ver getSurveyConfig. */
  malformed?: boolean
}

interface Props {
  appointments: CalendarAppointment[]
  initialDate: string
  clinicName: string
  doctors: CalendarDoctor[]
  /** El catálogo de servicios, para el desplegable de "Nueva cita". */
  consultationTypes?: OpcionServicio[]
  restrictDoctorId?: string | null
  userRole: string
  clinicId: string
  surveyConfig?: SurveyConfigForCalendar
}

export function CalendarView({ appointments: initialAppointments, initialDate, clinicName, doctors, restrictDoctorId, userRole, clinicId, surveyConfig, consultationTypes }: Props) {
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
  const [newAptPrefill, setNewAptPrefill] = useState<{ date: string; time: string; doctor_id: string; fuera_de_horario_confirmado?: boolean } | null>(null)
  // Cita que se está editando. Distinta de `newAptPrefill`: ésta lleva `id`, y
  // ese id es lo que hace que el modal llame a updateAppointment en vez de crear.
  const [editApt, setEditApt] = useState<CalendarAppointment | null>(null)

  // En celular la agenda abre en vista DÍA. La semana es una grilla de 8
  // columnas (56px + 7 días): en 390px cada día mide ~48px y es ilegible.
  //
  // La decisión se toma DESPUÉS de montar, nunca en el useState inicial: leer
  // el ancho durante el render daría un HTML distinto en el servidor y rompería
  // la hidratación — el mismo bug que nos tumbó el realtime. El primer render
  // es igual en los dos lados y recién el efecto ajusta.
  //
  // Si la URL trae ?view=, manda la URL: el usuario pidió esa vista.
  useEffect(() => {
    if (urlView) return
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setView('day')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          attendance_outcome: (newApt.attendance_outcome as CalendarAppointment['attendance_outcome']) ?? null,
          survey_sent: (newApt.survey_sent as boolean) ?? false,
          survey_sent_at: (newApt.survey_sent_at as string) ?? null,
          reason: (newApt.reason as string | null) ?? null,
          reminder_24h_sent: false,
          reminder_confirmed: null,
          payment_type: (newApt.payment_type as string) ?? '',
          doctor_id: (newApt.doctor_id as string | null) ?? null,
          modality: 'presencial',
          virtual_link: null,
          documents_requested: false,
          documents_received: false,
          free_text_reason: null,
          consultation_type_name: null,
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

  // Disponibilidad del médico seleccionado para la semana visible. Solo tiene
  // sentido con UN médico: en la vista "todos" no se puede afirmar el horario de
  // nadie en particular, así que la grilla se pinta neutra como antes.
  const [disponibilidad, setDisponibilidad] = useState<Record<string, DisponibilidadDelDia>>({})
  const semanaVisible = useMemo(() => {
    const lunes = getMonday(selectedDate)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(lunes); d.setDate(lunes.getDate() + i); return toDateStr(d)
    })
  }, [selectedDate])

  useEffect(() => {
    if (doctorFilter === 'all') { setDisponibilidad({}); return }
    let vigente = true
    getDisponibilidadAgenda(doctorFilter, semanaVisible)
      .then((r) => { if (vigente) setDisponibilidad(r) })
      .catch(() => { if (vigente) setDisponibilidad({}) })
    // `vigente` evita que una respuesta lenta de la semana anterior pise a la
    // de la semana que la secretaria ya tiene en pantalla.
    return () => { vigente = false }
  }, [doctorFilter, semanaVisible])

  /** Agendar desde la vista de día: la fecha ya la sabe la pantalla, y el médico
   *  también si hay uno filtrado. La HORA queda vacía a propósito — es lo único
   *  que la secretaria tiene que decidir, y si esa hora choca, ahí aparece la
   *  advertencia con el nombre de quien ya está en el cupo. No hay que declarar
   *  "voy a agendar un extra" antes: se decide cuando choca. */
  const abrirAgendar = useCallback((fecha: string) => {
    setEditApt(null)
    setNewAptPrefill({
      date: fecha,
      time: '',
      doctor_id: doctorFilter !== 'all' ? doctorFilter : '',
    })
    setShowNewAptModal(true)
  }, [doctorFilter])

  const abrirEdicion = useCallback((apt: CalendarAppointment) => {
    setEditApt(apt)
    setShowNewAptModal(true)
  }, [])

  // Bloqueos crudos de la semana, para la vista "Todos los médicos". La
  // disponibilidad por médico no aplica ahí, pero el bloqueo igual existe y
  // tiene que verse: si se aplica y no se pinta, es el mismo agujero que el
  // reload que sacamos — no se sabe si la acción funcionó.
  const [bloqueosSemana, setBloqueosSemana] = useState<{ doctor_id: string | null; start_date: string; end_date: string; reason: string | null }[]>([])
  const recargarBloqueos = useCallback(() => {
    const desde = semanaVisible[0]
    const hasta = semanaVisible[semanaVisible.length - 1]
    if (!desde || !hasta) return
    getBloqueosDeAgenda(desde, hasta)
      .then((r) => setBloqueosSemana(r.map((b) => ({ doctor_id: b.doctor_id, start_date: b.start_date, end_date: b.end_date, reason: b.reason }))))
      .catch(() => { /* la grilla se queda con lo último bueno */ })
  }, [semanaVisible])

  useEffect(() => { recargarBloqueos() }, [recargarBloqueos])

  // Releer la disponibilidad SIN recargar la página. Las citas ya viajan por
  // Realtime, pero `blocked_dates` no está en la publicación: sin esto, la
  // secretaria bloqueaba un día y la grilla seguía idéntica — que es
  // exactamente "no sé si funcionó". Antes acá había un window.location.reload().
  const recargarDisponibilidad = useCallback(() => {
    if (doctorFilter === 'all') return
    getDisponibilidadAgenda(doctorFilter, semanaVisible)
      .then(setDisponibilidad)
      .catch(() => { /* la grilla se queda con lo último bueno */ })
  }, [doctorFilter, semanaVisible])

  // Confirmación pendiente cuando el clic cayó en una celda cerrada.
  const [confirmarFuera, setConfirmarFuera] = useState<
    { date: string; hour: number; estado: EstadoFranja; motivo: string } | null
  >(null)

  function abrirFormNuevaCita(date: string, hour: number, confirmado: boolean) {
    setNewAptPrefill({
      date,
      time: `${String(hour).padStart(2, '0')}:00`,
      doctor_id: doctorFilter !== 'all' ? doctorFilter : (doctors[0]?.id ?? ''),
      fuera_de_horario_confirmado: confirmado,
    })
    setShowNewAptModal(true)
  }

  /** Clic en una celda de la grilla semanal — esté vacía u ocupada. Si está
   *  ocupada, el formulario va a chocar y ofrecer agendar un EXTRA; eso lo
   *  decide el server viendo la hora exacta que ella elija, no esta función. */
  function handleSlotClick(date: string, hour: number, estado: EstadoFranja, motivo: string) {
    // Fuera de franja o cerrado → primero la advertencia con el motivo concreto.
    if (estado !== 'disponible') {
      setConfirmarFuera({ date, hour, estado, motivo })
      return
    }
    abrirFormNuevaCita(date, hour, false)
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

      {/* ===== Leyenda de estados — SIEMPRE visible =====
          Antes sólo aparecía con un médico filtrado, y la vista por defecto es
          "todos": los colores quedaban sin explicación justo donde más gente
          los mira. Un color nuevo sin leyenda visible no sirve de nada. */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 500, color: 'var(--v2-text-subtle)', alignItems: 'center' }}>
        {[
          { label: 'Agendada', color: '#534AB7' },
          { label: 'Reagendada', color: '#BA7517' },
          { label: 'Completada', color: '#1D9E75' },
          { label: 'No-show', color: '#A32D2D' },
        ].map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color }} />
            {s.label}
          </span>
        ))}

        {/* Respuesta al recordatorio — otra dimensión, separada con un divisor
            para que no se lea como un estado más de la cita. */}
        <span style={{ width: '1px', height: '12px', background: 'var(--v2-border-soft)' }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="La paciente respondió que sí al recordatorio">
          <span style={{ color: CONFIRMO.color, fontWeight: 800 }}>{CONFIRMO.simbolo}</span>
          {CONFIRMO.label}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="La paciente respondió que NO va — hay que llamarla o liberar el cupo">
          <span style={{ display: 'inline-block', width: '4px', height: '12px', background: NO_CONFIRMO.color, borderRadius: '1px' }} />
          <span style={{ color: NO_CONFIRMO.color, fontWeight: 800 }}>{NO_CONFIRMO.simbolo}</span>
          {NO_CONFIRMO.label}
        </span>
      </div>

      {/* Leyenda de la GRILLA — qué significa cada fondo. Sin esto los colores
          son adivinanza: el reporte que originó esto fue justamente "no sabía si
          la agenda estaba llena o si tenía espacios". */}
      {doctorFilter !== 'all' && view === 'week' && (
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 500, color: 'var(--v2-text-subtle)' }}>
          {[
            { label: 'Atiende', bg: 'rgba(29,158,117,0.22)', rayado: false },
            { label: 'No atiende a esa hora', bg: 'rgba(120,113,130,0.20)', rayado: false },
            { label: 'Cerrado ese día', bg: 'rgba(163,48,107,0.18)', rayado: true },
          ].map((s) => (
            <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{
                width: '14px', height: '11px', borderRadius: '2px', background: s.bg,
                border: '1px solid var(--v2-border-soft)',
                backgroundImage: s.rayado
                  ? 'repeating-linear-gradient(135deg, rgba(163,48,107,0.4) 0 3px, transparent 3px 6px)'
                  : undefined,
              }} />
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
          surveyConfig={surveyConfig}
          disponibilidadDelDia={doctorFilter !== 'all' ? disponibilidad[toDateStr(selectedDate)] : undefined}
          onAgendaCambiada={() => { recargarDisponibilidad(); recargarBloqueos() }}
          bloqueosDelDia={bloqueosSemana.filter((b) => {
            const dia = toDateStr(selectedDate)
            if (dia < b.start_date || dia > b.end_date) return false
            // Con médico filtrado, el rosa ya lo pinta `disponibilidadDelDia`.
            return doctorFilter === 'all'
          })}
          doctoresTotales={doctors.length}
          onEditarCita={abrirEdicion}
          onAgendarCita={abrirAgendar}
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
          onSlotClick={handleSlotClick}
          disponibilidad={doctorFilter !== 'all' ? disponibilidad : undefined}
          doctorName={doctorFilter !== 'all' ? (doctors.find((d) => d.id === doctorFilter)?.name ?? null) : null}
          surveyConfig={surveyConfig}
          onEditarCita={abrirEdicion}
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
      {confirmarFuera && (
        <ConfirmarFueraHorarioModal
          estado={confirmarFuera.estado}
          motivo={confirmarFuera.motivo}
          fecha={confirmarFuera.date}
          hora={`${String(confirmarFuera.hour).padStart(2, '0')}:00`}
          onCancelar={() => setConfirmarFuera(null)}
          onConfirmar={() => {
            const c = confirmarFuera
            setConfirmarFuera(null)
            abrirFormNuevaCita(c.date, c.hour, true)
          }}
        />
      )}

      <AppointmentFormModal
        isOpen={showNewAptModal}
        onClose={() => { setShowNewAptModal(false); setNewAptPrefill(null); setEditApt(null) }}
        doctors={doctors as { id: string; name: string; specialty: string | null }[]}
        consultationTypes={consultationTypes}
        initialData={editApt ? {
          // Con `id` real el modal entra en modo edición y llama a
          // updateAppointmentFromDashboard. La hora va en COT: la cita se
          // guarda en UTC y el input type="time" muestra hora local.
          id: editApt.id,
          patient_id: editApt.patient?.id ?? '',
          patient_name: editApt.patient?.name ?? '',
          doctor_id: editApt.doctor_id ?? '',
          date: getColombiaDateStr(editApt.starts_at),
          time: `${String(getColombiaHour(editApt.starts_at)).padStart(2, '0')}:${String(getColombiaMinutes(editApt.starts_at)).padStart(2, '0')}`,
          duration_minutes: Math.max(
            5,
            Math.round((new Date(editApt.ends_at).getTime() - new Date(editApt.starts_at).getTime()) / 60000),
          ),
          reason: editApt.reason ?? '',
          payment_type: (editApt.payment_type || 'Particular') as 'Particular' | 'EPS' | 'Prepagada',
          eps_name: editApt.eps_name ?? '',
          modality: (editApt.modality === 'virtual' ? 'virtual' : 'presencial') as 'presencial' | 'virtual',
          virtual_link: editApt.virtual_link,
        } : newAptPrefill ? {
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
        fueraDeHorarioConfirmado={newAptPrefill?.fuera_de_horario_confirmado ?? false}
        onSaved={() => {
          setShowNewAptModal(false)
          setNewAptPrefill(null)
          setEditApt(null)
          // Las citas llegan por Realtime; sólo hay que releer disponibilidad
          // y bloqueos, que no viajan por ahí.
          recargarDisponibilidad()
          recargarBloqueos()
        }}
      />
    </div>
  )
}
