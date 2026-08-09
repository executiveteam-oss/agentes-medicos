'use client'

// ============================================================
// QuickActions — Marcado de asistencia de cita
// Migración 00073: campo attendance_outcome (admitido/facturado/inasistente)
// Estados modelados según columna FASE del export iSalud
//
// SurveyRow (embed): feedback + botón wa.me solo cuando attendance_outcome='facturado'
// - Ver Feature "Encuesta post-consulta" en CLAUDE.md
// ============================================================

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  markAsAdmitido,
  markAsFacturado,
  markAsInasistente,
  revertAttendanceOutcome,
} from '@/app/actions/appointments'
import { markSurveySentManually } from '@/app/actions/survey-config'
import { solicitarOrdenMedica } from '@/app/actions/contactar-paciente'
import { buildSurveyMessage } from '@/lib/rules/survey-config'
import { buildWhatsAppUrl, isValidColombianMobile } from '@/lib/utils/whatsapp-url'
import type { AppointmentStatus, AttendanceOutcome } from '@/types/database'
import { attendanceOutcomeLabel } from '@/lib/utils/attendance-outcome'

interface SurveyState {
  sent: boolean
  sentAt: string | null
  patientFirstName: string | null
  patientPhone: string | null
}

interface SurveyConfigForRow {
  enabled: boolean
  form_url: string | null
  clinic_display_name: string
  /** Hay config guardada pero mal formada. Ver getSurveyConfig. */
  malformed?: boolean
}

interface QuickActionsProps {
  appointmentId: string
  currentStatus: AppointmentStatus
  attendanceOutcome: AttendanceOutcome | null
  surveyState?: SurveyState
  surveyConfig?: SurveyConfigForRow | null
  /** Estado del pedido de orden médica para esta cita. */
  documentsRequested?: boolean
  documentsReceived?: boolean
}

export function QuickActions({ appointmentId, currentStatus, attendanceOutcome, surveyState, surveyConfig, documentsRequested = false, documentsReceived = false }: QuickActionsProps) {
  const [isPending, startTransition] = useTransition()

  // Pedido de ORDEN MÉDICA — post-consulta, para radicar la cuenta.
  // Vive acá porque es el único lugar con el contexto completo: paciente,
  // teléfono, fecha, hora y tipo de consulta. Y porque el pedido se registra en
  // la cita (documents_requested), que es lo que después ata el archivo que
  // llegue por WhatsApp.
  function BotonOrdenMedica() {
    const [pending, start] = useTransition()
    const [msg, setMsg] = useState<string | null>(null)
    if (documentsReceived) {
      return <div style={surveyBoxStyle('#ecfdf5', '#a7f3d0')}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#065f46' }}>✅ Orden médica recibida</span>
      </div>
    }
    return (
      <div style={surveyBoxStyle('#eff6ff', '#bfdbfe')}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a8a' }}>
          {documentsRequested ? '📄 Orden médica pedida — sin recibir' : '📄 Orden médica'}
        </div>
        <div style={{ fontSize: 11, color: '#1e3a8a', marginTop: 3, marginBottom: 6 }}>
          {documentsRequested
            ? 'Ya se le pidió. Podés volver a pedirla si no respondió.'
            : 'Pedila por WhatsApp para radicar la cuenta con la entidad.'}
        </div>
        <button
          className="v2-tap"
          disabled={pending}
          onClick={() => start(async () => {
            const r = await solicitarOrdenMedica(appointmentId)
            setMsg(r.ok ? '✅ Pedido enviado' : (r.error ?? 'No se pudo enviar'))
          })}
          style={{ fontWeight: 700, borderRadius: 6, border: '1px solid #1e3a8a',
                   background: 'transparent', color: '#1e3a8a', cursor: pending ? 'default' : 'pointer' }}
        >
          {pending ? 'Enviando…' : documentsRequested ? 'Volver a pedir' : 'Pedir orden médica'}
        </button>
        {msg && <div style={{ fontSize: 11, marginTop: 6, color: '#1e3a8a' }}>{msg}</div>}
      </div>
    )
  }


  // Si la cita está cancelada o bloqueo externo, no aplica marca de asistencia
  if (currentStatus === 'cancelled' || currentStatus === 'blocked_external') {
    return null
  }

  const stateLabel = attendanceOutcomeLabel(attendanceOutcome)
  const stateColor = colorFor(attendanceOutcome)

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--v2-border-soft)' }}>
      {/* Indicador del estado actual */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--v2-text-muted)', fontWeight: 600 }}>Estado</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: stateColor }}>{stateLabel}</span>
      </div>

      {/* 3 botones de marca */}
      <div style={{ display: 'flex', gap: 6 }}>
        <OutcomeButton
          label="Admitido"
          isActive={attendanceOutcome === 'admitido'}
          isDisabled={isPending}
          activeBg="#0EA5E9"
          onClick={() => startTransition(() => markAsAdmitido(appointmentId))}
        />
        <OutcomeButton
          label="Facturado"
          isActive={attendanceOutcome === 'facturado'}
          isDisabled={isPending}
          activeBg="#059669"
          onClick={() => startTransition(() => markAsFacturado(appointmentId))}
        />
        <OutcomeButton
          label="Inasistente"
          isActive={attendanceOutcome === 'inasistente'}
          isDisabled={isPending}
          activeBg="#DC2626"
          onClick={() => startTransition(() => markAsInasistente(appointmentId))}
        />
      </div>

      {/* Revertir solo si hay outcome marcado */}
      {attendanceOutcome !== null && (
        <button
          disabled={isPending}
          onClick={() => startTransition(() => revertAttendanceOutcome(appointmentId))}
          style={{
            marginTop: 6,
            width: '100%',
            background: 'transparent',
            color: 'var(--v2-text-muted)',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            cursor: isPending ? 'wait' : 'pointer',
          }}
        >
          ↺ Revertir a Programado
        </button>
      )}

      {/* Orden médica: se pide DESPUÉS de la consulta, para radicar la cuenta.
          Por eso aparece cuando la cita ya se atendió. */}
      {(attendanceOutcome === 'facturado' || attendanceOutcome === 'admitido') && <BotonOrdenMedica />}

      {/* SurveyRow: solo cuando la cita quedó Facturada */}
      {attendanceOutcome === 'facturado' && surveyState && (
        <SurveyRow
          appointmentId={appointmentId}
          state={surveyState}
          config={surveyConfig ?? null}
        />
      )}
    </div>
  )
}

// ============================================================
// SurveyRow — Feedback visual + botón wa.me para envío manual
// ============================================================

interface SurveyRowProps {
  appointmentId: string
  state: SurveyState
  config: SurveyConfigForRow | null
}

function SurveyRow({ appointmentId, state, config }: SurveyRowProps) {
  const [isPending, startTransition] = useTransition()
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // === Estado A — ya enviada
  if (state.sent) {
    const sentAtStr = state.sentAt ? formatSentAt(state.sentAt) : null
    return (
      <div style={surveyBoxStyle('#ecfdf5', '#a7f3d0')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#065f46' }}>✅ Encuesta enviada</span>
          {sentAtStr && (
            <span style={{ fontSize: 11, color: '#047857' }}>· {sentAtStr}</span>
          )}
        </div>
      </div>
    )
  }

  // === Estado E — HAY config guardada pero está mal formada.
  // Distinto de "no configurada": volver a guardar desde la UI no lo arregla.
  // Antes caía en el estado D y se veía idéntico a no haber configurado nunca,
  // así que la secretaria veía una advertencia que no podía resolver.
  if (config?.malformed) {
    return (
      <div style={surveyBoxStyle('#fee2e2', '#fecaca')}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b' }}>⚠ Encuesta mal configurada</div>
        <div style={{ fontSize: 11, color: '#991b1b', marginTop: 3 }}>
          Hay una configuración guardada que el sistema no puede leer. Volver a guardarla no
          lo resuelve — avisale a soporte.
        </div>
      </div>
    )
  }

  // === Estado D — config incompleta (feature no configurado por la clínica)
  if (!config || !config.form_url) {
    return (
      <div style={surveyBoxStyle('#fef3c7', '#fde68a')}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#78350f' }}>⚠ Encuesta no configurada</div>
        <div style={{ fontSize: 11, color: '#78350f', marginTop: 3, marginBottom: 6 }}>
          Configurá primero la URL del formulario en Automatizaciones.
        </div>
        <Link
          href="/dashboard/settings/automations/survey"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#92400e',
            textDecoration: 'underline',
          }}
        >
          → Configurar
        </Link>
      </div>
    )
  }

  // === Estado C — sin teléfono válido
  const validPhone = isValidColombianMobile(state.patientPhone)
  if (!validPhone) {
    return (
      <div style={surveyBoxStyle('var(--v2-bg-soft)', 'var(--v2-border-soft)')}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--v2-text-muted)' }}>⚠ Sin teléfono válido</div>
        <div style={{ fontSize: 11, color: 'var(--v2-text-muted)', marginTop: 3 }}>
          No se puede enviar la encuesta.
        </div>
      </div>
    )
  }

  // === Estado B — pendiente, todo listo para enviar
  const firstName = capitalizeFirst(state.patientFirstName ?? 'hola')
  const message = buildSurveyMessage({
    patientFirstName: firstName,
    clinicDisplayName: config.clinic_display_name,
    formUrl: config.form_url,
  })
  const waUrl = buildWhatsAppUrl(state.patientPhone as string, message)

  function handleOpenWhatsApp(): void {
    if (waUrl) {
      window.open(waUrl, '_blank', 'noopener,noreferrer')
      setAwaitingConfirm(true)
    }
  }

  function handleConfirmSent(): void {
    setErrorMsg(null)
    startTransition(async () => {
      const r = await markSurveySentManually(appointmentId)
      if (!r.ok) {
        setErrorMsg(r.error ?? 'Error marcando como enviada')
        setAwaitingConfirm(false)
      }
      // ok=true → revalidatePath refresca → survey_sent=true → Estado A
    })
  }

  return (
    <div style={surveyBoxStyle('#fef3c7', '#fde68a')}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#78350f', marginBottom: 6 }}>⚠ Encuesta no enviada</div>

      {!awaitingConfirm && (
        <button
          onClick={handleOpenWhatsApp}
          disabled={!waUrl || isPending}
          style={{
            width: '100%',
            background: '#25d366',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 700,
            cursor: !waUrl || isPending ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            opacity: !waUrl || isPending ? 0.5 : 1,
          }}
        >
          📤 Enviar por WhatsApp
        </button>
      )}

      {awaitingConfirm && (
        <div>
          <div style={{ fontSize: 11, color: '#78350f', marginBottom: 6 }}>
            Se abrió WhatsApp en otra pestaña. ¿Ya enviaste el mensaje?
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleConfirmSent}
              disabled={isPending}
              style={{
                flex: 1,
                background: '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 11,
                fontWeight: 700,
                cursor: isPending ? 'wait' : 'pointer',
              }}
            >
              {isPending ? 'Guardando…' : 'Sí, marcar como enviada'}
            </button>
            <button
              onClick={() => setAwaitingConfirm(false)}
              disabled={isPending}
              style={{
                background: 'transparent',
                color: '#78350f',
                border: '1px solid #fde68a',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 11,
                fontWeight: 600,
                cursor: isPending ? 'wait' : 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b' }}>{errorMsg}</div>
      )}
    </div>
  )
}

function surveyBoxStyle(bg: string, border: string): React.CSSProperties {
  return {
    marginTop: 10,
    padding: '10px 12px',
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 8,
  }
}

function capitalizeFirst(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function formatSentAt(iso: string): string {
  // Formato compacto: "2 jul 15:32"
  const d = new Date(iso)
  const day = d.getDate()
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const month = months[d.getMonth()]
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${month} ${h}:${m}`
}

function OutcomeButton({
  label,
  isActive,
  isDisabled,
  activeBg,
  onClick,
}: {
  label: string
  isActive: boolean
  isDisabled: boolean
  activeBg: string
  onClick: () => void
}) {
  return (
    <button
      disabled={isDisabled}
      onClick={onClick}
      style={{
        flex: 1,
        background: isActive ? activeBg : 'transparent',
        color: isActive ? '#fff' : 'var(--v2-text)',
        border: `1px solid ${isActive ? activeBg : 'var(--v2-border-soft)'}`,
        borderRadius: 8,
        padding: '8px 6px',
        fontSize: 11,
        fontWeight: 600,
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? 'wait' : 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function colorFor(o: AttendanceOutcome | null): string {
  switch (o) {
    case 'admitido': return '#0EA5E9'
    case 'facturado': return '#059669'
    case 'inasistente': return '#DC2626'
    case null: return 'var(--v2-text-muted)'
  }
}
