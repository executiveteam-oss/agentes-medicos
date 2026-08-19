// ============================================================
// DayView v2 — Stat cards + appointment list with inline expand
// ============================================================

import { useState, useTransition } from 'react'
import { descargarAgendaDiaria, type FormatoAgenda } from '@/app/actions/agenda-diaria'
import { getInitials, getAvatarGradient, AVATAR_GRADIENTS } from '@/lib/utils/ui-helpers'
import { formatTimeForPatient } from '@/lib/utils/dates'
import { Calendar, XCircle, Lock, FileText, Sheet } from 'lucide-react'
import { AppointmentDetail, type SurveyPropsForQuickActions } from './appointment-detail'
import { BulkCancelModal } from './bulk-cancel-modal'
import type { CalendarAppointment } from './types'
import type { DisponibilidadDelDia } from '@/lib/calendar/day-availability'
import { STATUS_STYLES, etiquetaEstado, toDateStr, MONTHS_ES, marcaConfirmacion } from './types'

/** Convert "JUAN PEREZ GOMEZ" → "Juan Perez Gomez". Skip if single word <4 chars (sigla). */
function toTitleCase(str: string): string {
  const words = str.trim().split(/\s+/)
  if (words.length === 1 && words[0].length < 4) return str
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Props {
  date: Date
  todayStr: string
  appointments: CalendarAppointment[]
  expandedApt: string | null
  setExpandedApt: (id: string | null) => void
  doctorFilter?: string  // 'all' or doctor_id
  doctorName?: string | null
  surveyConfig?: SurveyPropsForQuickActions
  /** Disponibilidad del día para el médico filtrado. Sin médico filtrado va
   *  undefined: no se puede afirmar el horario de nadie en particular. */
  disponibilidadDelDia?: DisponibilidadDelDia
  /** Releer la disponibilidad tras bloquear, sin recargar la página. */
  onAgendaCambiada?: () => void
  /** Bloqueos que cubren este día. Sólo viene poblado en "Todos los médicos":
   *  con médico filtrado el rosa lo pinta `disponibilidadDelDia`. */
  bloqueosDelDia?: { doctor_id: string | null; reason: string | null }[]
  /** Cuántos médicos activos tiene la clínica, para decir "3 de 5". */
  doctoresTotales?: number
  /** Abrir el formulario con la cita cargada. */
  onEditarCita?: (apt: CalendarAppointment) => void
}




export function DayView({ date, todayStr, appointments, expandedApt, setExpandedApt, doctorFilter, doctorName, surveyConfig, disponibilidadDelDia, onAgendaCambiada, bloqueosDelDia, doctoresTotales, onEditarCita }: Props) {
  const dateStr = toDateStr(date)
  const isToday = dateStr === todayStr
  const [showBulkCancel, setShowBulkCancel] = useState(false)
  const [bajando, startBajar] = useTransition()
  const [formatoBajando, setFormatoBajando] = useState<FormatoAgenda | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const total = appointments.length
  const completed = appointments.filter((a) => a.attendance_outcome === 'facturado').length
  const noShows = appointments.filter((a) => a.attendance_outcome === 'inasistente').length
  const pending = appointments.filter((a) => a.status === 'confirmed' || a.status === 'rescheduled').length

  function bajarAgenda(formato: FormatoAgenda) {
    if (!isFilteredDoctor) return
    setFormatoBajando(formato)
    startBajar(async () => {
      try {
        const r = await descargarAgendaDiaria(doctorFilter!, dateStr, formato)
        if (!r.ok || !r.archivoBase64) {
          setToast(r.error ?? 'No se pudo generar el archivo')
          setTimeout(() => setToast(null), 4000)
          return
        }
        // base64 → Blob → descarga. El navegador lo abre o lo guarda.
        const bytes = Uint8Array.from(atob(r.archivoBase64), (ch) => ch.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }))
        const a = document.createElement('a')
        a.href = url; a.download = r.filename ?? `agenda.${formato}`; a.click()
        URL.revokeObjectURL(url)
        setToast(`Agenda de ${toTitleCase(doctorName ?? '')} — ${r.citas} cita${r.citas === 1 ? '' : 's'}`)
        setTimeout(() => setToast(null), 3000)
      } finally {
        setFormatoBajando(null)
      }
    })
  }

  const dateFormatted = format(date, "EEEE d 'de' MMMM", { locale: es })
  const isFilteredDoctor = doctorFilter && doctorFilter !== 'all'

  // Qué decir sobre el día cerrado. Con médico filtrado la respuesta ya la dio
  // day-availability; sin filtrar hay que resumir los bloqueos crudos, porque
  // ahí no se puede afirmar el horario de nadie en particular.
  const bloqueoDeClinica = bloqueosDelDia?.find((b) => b.doctor_id === null)
  const bloqueosPorMedico = bloqueosDelDia?.filter((b) => b.doctor_id !== null) ?? []
  const avisoDeCierre = disponibilidadDelDia?.bloqueo
    ? {
        titulo: `Día cerrado${doctorName ? ` · ${toTitleCase(doctorName)}` : ''}`,
        motivo: disponibilidadDelDia.bloqueo.motivo,
      }
    : bloqueoDeClinica
      ? { titulo: 'Día cerrado para TODA la clínica', motivo: bloqueoDeClinica.reason }
      : bloqueosPorMedico.length > 0
        ? {
            titulo: doctoresTotales
              ? `Día cerrado para ${bloqueosPorMedico.length} de ${doctoresTotales} médicos`
              : `Día cerrado para ${bloqueosPorMedico.length} médico${bloqueosPorMedico.length === 1 ? '' : 's'}`,
            motivo: bloqueosPorMedico.find((b) => b.reason)?.reason ?? null,
          }
        : null

  return (
    <div style={{ fontFamily: 'var(--font-manrope), sans-serif' }} className="space-y-4">
      {/* Día cerrado — el MISMO rosa rayado que usa la vista de semana para
          `bloqueado`. El rayado no es adorno: distingue "cerrado a propósito"
          de "no hay nada agendado". Sin esto, un día bloqueado y un día vacío
          se veían igual en la vista de día. */}
      {avisoDeCierre && (
        <div
          title={avisoDeCierre.motivo ?? 'Día cerrado'}
          style={{
            padding: '12px 14px', borderRadius: 'var(--v2-radius)',
            border: '1px solid rgba(163,48,107,0.35)',
            background: 'rgba(163,48,107,0.10)',
            backgroundImage: 'repeating-linear-gradient(135deg, rgba(163,48,107,0.14) 0 5px, transparent 5px 10px)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
        >
          <Lock size={14} style={{ color: '#A3306B', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#A3306B' }}>{avisoDeCierre.titulo}</p>
            {avisoDeCierre.motivo && (
              <p style={{ fontSize: '12px', color: 'var(--v2-text)', marginTop: '1px' }}>{avisoDeCierre.motivo}</p>
            )}
            <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginTop: '1px' }}>
              El agente no ofrece cupos este día
            </p>
          </div>
        </div>
      )}

      {/* Stat cards + bulk cancel button */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        {/* minWidth:0 — sin esto la grilla no se achica por debajo del ancho de
            sus tarjetas y se pelea por el espacio con el botón de cancelar, que
            tampoco cedía (nowrap + flexShrink:0). Ninguno de los dos entregaba
            ancho: se superponían y empujaban la página más allá del viewport. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" style={{ flex: 1, minWidth: 0 }}>
        <StatCard label="Total" value={total} color="var(--v2-text)" />
        <StatCard label="Pendientes" value={pending} color="var(--v2-primary)" />
        <StatCard label="Completadas" value={completed} color="var(--v2-green)" />
        <StatCard label="No-shows" value={noShows} color="var(--v2-red)" />
        </div>
        <button
            onClick={() => setShowBulkCancel(true)}
            className="max-lg:w-full"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              fontSize: '12px', fontWeight: 600, padding: '10px 14px',
              borderRadius: 'var(--v2-radius)',
              border: pending === 0 ? '1px solid rgba(163,48,107,0.3)' : '1px solid rgba(255,87,87,0.3)',
              background: pending === 0 ? 'rgba(163,48,107,0.10)' : 'var(--v2-red-soft)',
              color: pending === 0 ? '#A3306B' : 'var(--v2-red)',
              cursor: 'pointer', fontFamily: 'var(--font-manrope), sans-serif',
              // Sin nowrap: "Cancelar citas de JUAN DIEGO VILLEGAS ECHEVERRI" son
              // ~330px indivisibles, más que un teléfono entero. En celular el botón
              // toma su propia fila completa; en computador la fila sigue entrando.
              minWidth: 0,
            }}
          >
            {pending === 0 ? <Lock size={14} /> : <XCircle size={14} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {pending === 0
                // Sin citas no hay nada que cancelar, pero SÍ hay algo que
                // hacer: cerrar el día para que no entre nadie nuevo. Antes el
                // botón no existía y no había forma de bloquear preventivamente
                // desde la agenda, que es donde te enterás de que el médico no viene.
                ? (isFilteredDoctor && doctorName ? `Bloquear el día de ${doctorName}` : 'Bloquear el día')
                : isFilteredDoctor && doctorName
                  ? `Cancelar citas de ${doctorName}`
                  : 'Cancelar todas las citas'}
            </span>
        </button>
      </div>

      {/* Los dos formatos, juntos. Se llaman DESCARGAR y no "imprimir": lo que
          los botones hacen es bajar un archivo; imprimirlo es lo que hace
          después la secretaria.

          Van SIEMPRE visibles, deshabilitados cuando no hay médico filtrado, en
          vez de desaparecer: un botón que no está no se puede descubrir, y no
          hay forma de saber si falta porque no aplica o porque algo se rompió. */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
        {([
          { formato: 'pdf' as const, label: 'Descargar PDF', icono: <FileText size={14} /> },
          { formato: 'xlsx' as const, label: 'Descargar Excel', icono: <Sheet size={14} /> },
        ]).map(({ formato, label, icono }) => (
          <button
            key={formato}
            onClick={() => bajarAgenda(formato)}
            disabled={bajando || !isFilteredDoctor}
            title={isFilteredDoctor
              ? `Descarga las citas del día de este médico en ${formato.toUpperCase()}`
              : 'Filtrá la agenda por un médico: se descarga una hoja por médico'}
            className="max-lg:w-full"
            style={{
              flex: '1 1 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              fontSize: '12px', fontWeight: 600, padding: '10px 14px',
              borderRadius: 'var(--v2-radius)', border: '1px solid var(--v2-border-soft)',
              background: 'transparent', color: 'var(--v2-text)',
              cursor: bajando ? 'wait' : isFilteredDoctor ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font-manrope), sans-serif',
              opacity: bajando || !isFilteredDoctor ? 0.5 : 1,
            }}
          >
            {icono}
            {formatoBajando === formato
              ? 'Generando...'
              : isFilteredDoctor ? label : `${label} — elegí un médico`}
          </button>
        ))}
      </div>

      {/* Bulk cancel modal */}
      {showBulkCancel && (
        <BulkCancelModal
          date={dateStr}
          dateFormatted={dateFormatted}
          appointments={appointments}
          doctorId={isFilteredDoctor ? doctorFilter! : null}
          doctorName={isFilteredDoctor ? (doctorName ?? null) : null}
          onClose={() => setShowBulkCancel(false)}
          onDone={(cancelled, notified) => {
            setShowBulkCancel(false)
            setToast(cancelled > 0
              ? `${cancelled} citas canceladas · ${notified} pacientes notificados`
              : 'Día bloqueado')
            // Sin reload: las citas llegan por Realtime y el bloqueo lo trae
            // onAgendaCambiada. La grilla tiene que cambiar sola — si hay que
            // recargar para ver el resultado, no se sabe si funcionó.
            onAgendaCambiada?.()
            setTimeout(() => setToast(null), 3000)
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, padding: '12px 20px', borderRadius: 'var(--v2-radius)', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--v2-text)', boxShadow: 'var(--v2-shadow-lg)' }}>
          {toast}
        </div>
      )}

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
            const patientName = toTitleCase(patient?.name ?? apt.reason ?? 'Sin nombre')

            // Solo el caso malo tiñe el borde: "confirmó" ya se lee en el ✓.
            const marca = marcaConfirmacion(apt.reminder_confirmed)
            const resalta = marca?.resalta ? marca : null

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
                    background: resalta ? 'rgba(212,53,28,0.06)' : 'none',
                    border: 'none',
                    // DESPUÉS de `border: none`, si no lo pisa.
                    borderLeft: resalta ? `4px solid ${resalta.color}` : '4px solid transparent',
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
                      background: getAvatarGradient(patientName),
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
                    <p style={{ fontSize: '13.5px', fontWeight: 700, color: apt.attendance_outcome === 'inasistente' ? 'var(--v2-text-subtle)' : 'var(--v2-text)', textDecoration: apt.attendance_outcome === 'inasistente' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {/* ✓/✕ de confirmación — ver marcaConfirmacion en ./types */}
                      {marcaConfirmacion(apt.reminder_confirmed) && (
                        <span
                          title={marcaConfirmacion(apt.reminder_confirmed)!.label}
                          style={{ color: marcaConfirmacion(apt.reminder_confirmed)!.color, fontWeight: 800, marginRight: '5px' }}
                        >
                          {marcaConfirmacion(apt.reminder_confirmed)!.simbolo}
                        </span>
                      )}
                      {patientName}
                    </p>
                    {doctor && <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)' }}>{doctor.name}</p>}
                    {patient?.entidad && <p style={{ fontSize: '11px', color: 'var(--v2-text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏥 {patient.entidad}</p>}
                  </div>

                  {/* Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, flexWrap: 'wrap' }}>
                    {apt.modality === 'virtual' && <Pill bg="var(--v2-primary-soft)" fg="var(--v2-primary)">Virtual</Pill>}
                    {apt.documents_requested && (
                      <Pill bg={apt.documents_received ? 'var(--v2-green-soft)' : 'var(--v2-amber-soft)'} fg={apt.documents_received ? 'var(--v2-green-deep)' : '#b07d00'}>
                        Docs {apt.documents_received ? 'ok' : '⏳'}
                      </Pill>
                    )}
                    <Pill bg={st.bg} fg={st.fg}>{etiquetaEstado(apt.status, apt.reason, apt.source)}</Pill>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--v2-text-subtle)', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>
                      <path d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <AppointmentDetail appointment={apt} onClose={() => setExpandedApt(null)} surveyConfig={surveyConfig} onEditar={onEditarCita} />
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
