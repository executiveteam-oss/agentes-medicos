// ============================================================
// WeekView v2 — single-doctor, redesigned appointment cells
// Shows ONE doctor at a time (selected via DoctorSelector)
// ============================================================

import { formatTimeForPatient } from '@/lib/utils/dates'
import { Tooltip } from '@/components/ui/tooltip'
import { AppointmentDetail } from './appointment-detail'
import type { CalendarAppointment } from './types'
import { estadoDeFranja, motivoParaConfirmar, type EstadoFranja, type DisponibilidadDelDia } from '@/lib/calendar/day-availability'
import { DAYS_ES, HOURS, getMonday, getWeekDates, toDateStr, getColombiaDateStr, getColombiaHour, getColombiaMinutes, etiquetaEstado, esCupoCompartido, marcaConfirmacion } from './types'

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

// ============================================================
// ESCALA DE LA GRILLA — un solo lugar.
//
// Antes era 1px = 1min. Con eso una cita de 20 min (la duración más común de
// esta agenda) medía 18px, y en 18px no entran dos líneas de texto: el nombre
// de la paciente se recortaba FUERA DE VISTA y quedaba visible solo la segunda
// línea. Parecía un dato faltante y era un problema de altura.
//
// 1.6 px/min deja la cita de 20 min en 30px: 26px útiles descontando el padding,
// que es lo que ocupan las dos líneas (13.2 + 12 = 25.2px). Con 1.5 quedaba en
// 28px — entraba raspando y la segunda línea se cortaba por abajo.
//
// Costo: la grilla crece 60%. Cada hora pasa de 60px a 96px, así que el
// contenedor scrollea antes (por eso maxHeight sube de 600 a 720px).
const PX_PER_MIN = 1.6
const HOUR_CELL_PX = 60 * PX_PER_MIN   // 96px

// Fondo de la celda según el estado de la franja.
//
// El problema que resuelve: toda la grilla se pintaba igual, así que la
// secretaria no distinguía "hueco libre" de "el médico no atiende". Carolina lo
// dijo así: "me aparece en blanco y si yo le doy en cualquier lado pues me va a
// seleccionar la hora… no sabía si la agenda estaba llena o si tenía espacios".
//
// Verde muy suave para lo disponible —tiene que leerse como fondo, no competir
// con las tarjetas de las citas—, gris para fuera de horario, y rosa + rayado
// para lo cerrado a propósito. El rayado no es adorno: es lo que distingue los
// dos estados sin depender de acertarle al tono del gris.
const FONDO_FRANJA: Record<EstadoFranja, string> = {
  disponible: 'rgba(29,158,117,0.07)',
  fuera_de_horario: 'rgba(120,113,130,0.10)',
  bloqueado: 'rgba(163,48,107,0.10)',
}

// Status colors for single-doctor view (redesigned)
const STATUS_CELL_COLORS: Record<string, { bg: string; border: string }> = {
  confirmed:       { bg: '#EEEDFE', border: '#534AB7' },
  rescheduled:     { bg: '#FAEEDA', border: '#BA7517' },
  completed:       { bg: '#E1F5EE', border: '#1D9E75' },
  no_show:         { bg: '#FCEBEB', border: '#A32D2D' },
  // Rayado y rosa: antes era idéntica a `confirmed` (#EEEDFE/#534AB7) y en la
  // grilla no había forma de distinguir una cita normal de una que comparte
  // cupo y no se puede marcar. El rayado se ve incluso en las tarjetas de 16px,
  // donde el texto ya no entra.
  blocked_external:{ bg: '#FDECF4', border: '#A3306B' },
  cancelled:       { bg: '#F4F2FB', border: '#9590A8' },
}

interface Props {
  selectedDate: Date
  todayStr: string
  appointments: CalendarAppointment[]
  onDayClick: (d: Date) => void
  expandedApt: string | null
  setExpandedApt: (id: string | null) => void
  onEmptySlotClick?: (date: string, hour: number, estado: EstadoFranja, motivo: string) => void
  /** Disponibilidad por fecha del médico seleccionado. Sin esto (vista "todos
   *  los médicos") la grilla se pinta neutra, como antes. */
  disponibilidad?: Record<string, DisponibilidadDelDia>
  /** Nombre del médico, para el texto de la advertencia. */
  doctorName?: string | null
  /** Config de la encuesta para QuickActions. Sin esto el panel dice
      "Encuesta no configurada" aunque esté perfectamente configurada. */
  surveyConfig?: React.ComponentProps<typeof AppointmentDetail>['surveyConfig']
}

export function WeekView({ selectedDate, todayStr, appointments, onDayClick, expandedApt, setExpandedApt, onEmptySlotClick, surveyConfig, disponibilidad, doctorName }: Props) {
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
        <div style={{ overflowY: 'auto', maxHeight: '720px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', position: 'relative' }}>
            {HOURS.map((hour) => (
              <div key={hour} style={{ display: 'contents' }}>
                {/* Hour label */}
                <div style={{ padding: '4px 6px', textAlign: 'right', borderBottom: '1px solid var(--v2-border-soft)', height: `${HOUR_CELL_PX}px` }}>
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

                  // El estado de la celda. Sin `disponibilidad` (vista de todos
                  // los médicos) queda null y la grilla se pinta como antes:
                  // no se puede afirmar el horario de nadie en particular.
                  const disp = disponibilidad?.[dateStr] ?? null
                  const estado = disp ? estadoDeFranja(disp, `${String(hour).padStart(2, '0')}:00`) : null
                  const fondo = estado ? FONDO_FRANJA[estado] : (isToday ? 'rgba(107,91,255,0.02)' : 'transparent')
                  const motivoCelda = disp && estado && estado !== 'disponible'
                    ? motivoParaConfirmar(disp, doctorName ?? 'El médico') : ''

                  return (
                    <div
                      key={colIdx}
                      className="group"
                      style={{
                        borderLeft: '1px solid var(--v2-border-soft)',
                        borderBottom: '1px solid var(--v2-border-soft)',
                        height: `${HOUR_CELL_PX}px`,
                        position: 'relative',
                        padding: '1px',
                        background: fondo,
                        // El rayado distingue "cerrado a propósito" de "no
                        // atiende a esa hora" incluso para quien no separa bien
                        // dos grises: son decisiones distintas para quien agenda.
                        backgroundImage: estado === 'bloqueado'
                          ? 'repeating-linear-gradient(135deg, rgba(163,48,107,0.14) 0 5px, transparent 5px 10px)'
                          : undefined,
                        cursor: hourAppts.length === 0 && onEmptySlotClick ? 'pointer' : 'default',
                      }}
                      title={motivoCelda || undefined}
                      onClick={() => {
                        if (hourAppts.length === 0 && onEmptySlotClick) {
                          onEmptySlotClick(dateStr, hour, estado ?? 'disponible', motivoCelda)
                        }
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
                            color: estado && estado !== 'disponible' ? '#92400e' : 'var(--v2-primary)',
                            background: estado && estado !== 'disponible' ? 'rgba(253,230,138,0.55)' : 'var(--v2-primary-tint)',
                            borderRadius: '2px',
                            textAlign: 'center', lineHeight: 1.15, padding: '0 4px',
                          }}
                        >
                          {estado === 'bloqueado' ? '⚠ Cerrado' : estado === 'fuera_de_horario' ? '⚠ Fuera de horario' : '+ Agendar'}
                        </span>
                      )}

                      {/* Appointment cells */}
                      {hourAppts.map((apt) => {
                        const colors = STATUS_CELL_COLORS[apt.status] ?? STATUS_CELL_COLORS.confirmed
                        // El FONDO sigue siendo del estado; el borde izquierdo pasa a
                        // la confirmación solo cuando la paciente dijo que no va.
                        const marcaConf = marcaConfirmacion(apt.reminder_confirmed)
                        const bordeConf = marcaConf?.resalta ? marcaConf.color : null
                        const minutes = getColombiaMinutes(apt.starts_at)
                        const topPx = minutes * PX_PER_MIN

                        // Calculate duration for height (1 min = 1px, -2px gap between consecutive)
                        const startMs = new Date(apt.starts_at).getTime()
                        const endMs = new Date(apt.ends_at).getTime()
                        const durationMin = Math.round((endMs - startMs) / 60000)
                        const heightPx = Math.max(16, durationMin * PX_PER_MIN - 2) // -2px = separación visual entre consecutivas

                        // Patient name: real patients have patient.name, iSalud uses reason
                        const rawName = apt.patient?.name ?? apt.reason ?? 'Sin nombre'
                        const fullName = toTitleCase(rawName)
                        const patientName = abbreviateName(fullName)
                        const consultType = apt.consultation_type_name ?? apt.external_service_name ?? apt.free_text_reason ?? ''
                        const cupoCompartido = esCupoCompartido(apt.status, apt.reason)

                        // La segunda línea se decide por ALTURA DISPONIBLE, no por duración:
                        // el recorte lo causa el espacio, así que la condición tiene que
                        // mirar el espacio. 30px = 26px útiles = las dos líneas justas.
                        const showSecondLine = heightPx >= 30
                        // Hora · servicio en UNA línea. Sin tipo de consulta (las
                        // importadas del HIS) queda solo la hora, sin separador colgando.
                        const secondLine = [formatTimeForPatient(apt.starts_at), consultType]
                          .filter(Boolean).join(' · ')
                        const fontSize = heightPx < 24 ? '10px' : '11px'
                        const padY = heightPx < 34 ? '2px' : '3px'

                        // Orden: servicio (destacado) → paciente → médico → estado → pago.
                        // El tipo de pago solo significa algo en las citas del agente: en el
                        // resto es el DEFAULT 'Particular' de la columna, que nadie escribe.
                        const tooltipContent = (
                          <>
                            <span style={{ fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                              {consultType || 'Sin tipo de consulta'}
                            </span>
                            <span style={{ display: 'block' }}>{fullName}</span>
                            {apt.doctor?.name && <span style={{ display: 'block', opacity: 0.85 }}>Dr. {apt.doctor.name}</span>}
                            <span style={{ display: 'block', opacity: 0.85 }}>Estado: {etiquetaEstado(apt.status, apt.reason)}</span>
                            {cupoCompartido && (
                              <span style={{ display: 'block', marginTop: '4px', opacity: 0.85 }}>
                                Comparte el horario con otra cita en iSalud. No se le puede marcar asistencia.
                              </span>
                            )}
                            {apt.source === 'whatsapp_agent' && apt.payment_type && (
                              <span style={{ display: 'block', opacity: 0.85 }}>Pago: {apt.payment_type}</span>
                            )}
                          </>
                        )

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
                                // Rayado SOLO para cupo compartido: distingue de un
                                // vistazo sin depender de leer el texto.
                                background: cupoCompartido
                                  ? `repeating-linear-gradient(135deg, ${colors.bg} 0 6px, #fff 6px 12px)`
                                  : colors.bg,
                                borderLeft: `3px solid ${colors.border}`,
                                borderRadius: '4px',
                                padding: `${padY} 6px`,
                                cursor: 'pointer',
                                overflow: 'hidden',
                                zIndex: 10,
                                border: 'none',
                                textAlign: 'left',
                                transition: 'box-shadow 0.1s',
                                fontFamily: 'var(--font-manrope), sans-serif',
                                borderLeftStyle: 'solid',
                                borderLeftWidth: bordeConf ? '5px' : '3px',
                                borderLeftColor: bordeConf ?? colors.border,
                                display: 'flex',
                                flexDirection: 'column',
                                // flex-start, NO center: con center el excedente se recorta
                                // arriba Y abajo, y lo que desaparecía era la primera línea
                                // — el nombre de la paciente. Anclado arriba, el nombre
                                // sobrevive siempre y lo que se corta es lo de abajo.
                                justifyContent: 'flex-start',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
                            >
                              <p style={{ fontSize, fontWeight: 700, color: 'var(--v2-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                                {marcaConf && (
                                  <span title={marcaConf.label} style={{ color: marcaConf.color, fontWeight: 800, marginRight: '3px' }}>
                                    {marcaConf.simbolo}
                                  </span>
                                )}
                                {patientName}
                              </p>
                              {showSecondLine && (
                                <p style={{ fontSize: '10px', color: 'var(--v2-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                                  {secondLine}
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
        {/* Detalle: panel lateral FIJO, no un bloque debajo de la grilla.
            Antes había que scrollear para verlo — con la grilla más alta era peor. */}
        {expandedApt && (() => {
          const apt = appointments.find((a) => a.id === expandedApt)
          if (!apt) return null
          return (
            <>
              {/* Velo: click afuera cierra */}
              <div
                onClick={() => setExpandedApt(null)}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 90 }}
              />
              <aside
                style={{
                  position: 'fixed', top: 0, right: 0, bottom: 0,
                  width: 'min(420px, 100vw)',
                  background: 'var(--v2-bg-card)',
                  borderLeft: '1px solid var(--v2-border-soft)',
                  boxShadow: 'var(--v2-shadow-lg)',
                  zIndex: 91,
                  overflowY: 'auto',
                }}
              >
                <AppointmentDetail appointment={apt} onClose={() => setExpandedApt(null)} surveyConfig={surveyConfig} />
              </aside>
            </>
          )
        })()}
      </div>
    </div>
  )
}
