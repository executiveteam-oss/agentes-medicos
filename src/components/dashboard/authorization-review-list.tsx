'use client'

// ============================================================
// AuthorizationReviewList — Bloque 4 (slice chico, 2026-07-29)
//
// Bandeja de archivos recibidos. Por tarjeta:
//  - Preview inline del documento (img/PDF) + link.
//  - Panel de CONVERSACIÓN (últimos N mensajes) para dar contexto al juzgar.
//  - Aprobar y agendar → AppointmentFormModal (selectores reales, sin UUIDs).
//  - Rechazar → motivo predefinido (texto amable a la paciente) + libre.
//
// NO incluye (rediseño completo, spec 2026-07-27): tabla authorization_requests,
// historial de intentos, "devolver al agente", navegación/remoción optimista.
// ============================================================

import { useState, useTransition, useEffect, useMemo } from 'react'
import {
  getAuthorizationFileUrl,
  rejectAuthorization,
  markMediaReviewed,
  markMediaApproved,
  approveAndReturnToAgent,
  getConversationTail,
} from '@/app/actions/authorization-review'
// El tipo viene de lib: un módulo 'use server' solo puede exportar funciones
// async, así que no puede re-exportarlo.
import type { PendingAuthorization } from '@/lib/media/archivos-sin-revisar'
import { REJECT_REASONS } from '@/lib/rules/reject-reasons'
import { detectEscalateService } from '@/lib/safety/escalate-service-matcher'
import { AppointmentFormModal } from '@/components/dashboard/appointment-form-modal'

interface DoctorOption {
  id: string
  name: string
  specialty: string | null
}

export function AuthorizationReviewList({
  items,
  doctors,
  minBookingAdvanceHours,
  downloadEnabled,
}: {
  items: PendingAuthorization[]
  doctors: DoctorOption[]
  minBookingAdvanceHours?: number
  downloadEnabled?: boolean
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {items.map((item) => (
        <AuthorizationCard key={item.media_id} item={item} doctors={doctors} minBookingAdvanceHours={minBookingAdvanceHours} downloadEnabled={downloadEnabled} />
      ))}
    </div>
  )
}

function AuthorizationCard({
  item,
  doctors,
  minBookingAdvanceHours,
  downloadEnabled,
}: {
  item: PendingAuthorization
  doctors: DoctorOption[]
  minBookingAdvanceHours?: number
  downloadEnabled?: boolean
}): React.JSX.Element {
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [loadingUrl, setLoadingUrl] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewState, setReviewState] = useState<'idle' | 'rejecting' | 'done'>('idle')
  const [doneNote, setDoneNote] = useState<string | null>(null)
  const [isMarking, startMark] = useTransition()
  const [modalOpen, setModalOpen] = useState(false)
  const [convMsgs, setConvMsgs] = useState<{ role: string; content: string; created_at: string }[] | null>(null)

  // URL firmada del documento
  useEffect(() => {
    let mounted = true
    setLoadingUrl(true)
    getAuthorizationFileUrl(item.media_id).then((r) => {
      if (!mounted) return
      if (r.ok && r.url) setFileUrl(r.url)
      else setError(r.error ?? 'Error cargando archivo')
      setLoadingUrl(false)
    }).catch((e) => {
      if (mounted) { setError(String(e)); setLoadingUrl(false) }
    })
    return () => { mounted = false }
  }, [item.media_id])

  // Contexto: últimos mensajes de la conversación
  useEffect(() => {
    let mounted = true
    getConversationTail(item.conversation_id).then((r) => {
      if (mounted && r.ok) setConvMsgs(r.messages ?? [])
    }).catch(() => { /* no crítico */ })
    return () => { mounted = false }
  }, [item.conversation_id])

  const isImage = item.mime_type?.startsWith('image/') ?? false
  const isPdf = item.mime_type === 'application/pdf'
  const isAuthorization = item.context === 'authorization'
  const prefillPatient = useMemo(
    () => (item.patient_id ? { id: item.patient_id, name: item.patient_name ?? '' } : undefined),
    [item.patient_id, item.patient_name],
  )

  function handleMarkReviewed(): void {
    setError(null)
    startMark(async () => {
      const r = await markMediaReviewed(item.media_id)
      if (!r.ok) { setError(r.error ?? 'Error'); return }
      setDoneNote(null)
      setReviewState('done')
    })
  }

  function handleApprovedAndScheduled(): void {
    startMark(async () => {
      await markMediaApproved(item.media_id)
      setDoneNote('✓ Aprobada y cita agendada.')
      setReviewState('done')
    })
  }

  // Guía determinista: ¿la conversación menciona un servicio con regla
  // escalate_human? Mismo matcher de Capa 0, corrido sobre el chat. Si sí,
  // el agente NO puede agendarlo (la capa B lo bloquea) → guiar a "Agendar yo".
  const ruledService = useMemo(() => {
    if (!convMsgs) return null
    for (const msg of convMsgs) {
      const d = detectEscalateService(msg.content)
      if (d.matched) return d.label ?? 'ese procedimiento'
    }
    return null
  }, [convMsgs])

  function handleApproveAgent(): void {
    startMark(async () => {
      const r = await approveAndReturnToAgent(item.media_id)
      if (!r.ok) { setError(r.error ?? 'Error'); return }
      setDoneNote(r.windowClosed
        ? '✓ Aprobada. La ventana de 24h está cerrada — el agente no pudo avisar todavía; contacta a la paciente o espera el template.'
        : '✓ Aprobada. El agente le está ofreciendo horarios a la paciente.')
      setReviewState('done')
    })
  }

  if (reviewState === 'done') {
    return (
      <div className="card-v2" style={{ padding: '16px', opacity: 0.7 }}>
        <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)' }}>
          {doneNote ?? '✓ Revisado'} — se actualizará la lista al recargar la página.
        </p>
      </div>
    )
  }

  return (
    <div className="card-v2" style={{ padding: '16px' }}>
      {/* Header con info del paciente */}
      <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--v2-border-soft)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', marginBottom: '4px', color: isAuthorization ? 'var(--v2-primary)' : 'var(--v2-text-muted)' }}>
              {isAuthorization ? '🛡 Autorización' : '📎 Documento'}
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>
              {item.patient_name ?? 'Paciente sin nombre'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>
              {item.patient_phone}
            </div>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--v2-text-muted)' }}>
            Recibido: {new Date(item.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
          </div>
        </div>
      </div>

      {/* Cuerpo: documento + conversación lado a lado (apila en pantallas chicas) */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {/* Documento */}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginBottom: '6px' }}>
            📎 {item.filename ?? (isPdf ? 'documento.pdf' : 'imagen')} ({item.mime_type})
            {item.size_bytes && ` — ${Math.round(item.size_bytes / 1024)}KB`}
          </div>
          {downloadEnabled && (
            <div style={{ marginBottom: '8px' }}>
              {/* Descarga la orden ya nombrada para radicar. GET a la ruta con
                  Content-Disposition attachment → baja sin salir de la página. */}
              <a
                href={`/api/authorizations/download?ids=${item.media_id}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--v2-primary)', textDecoration: 'none', padding: '4px 10px', border: '1px solid var(--v2-border-soft)', borderRadius: '6px' }}
              >
                ⬇ Descargar PDF
              </a>
            </div>
          )}
          {loadingUrl && <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>Cargando archivo…</div>}
          {error && <div style={{ fontSize: '12px', color: 'var(--v2-red)' }}>Error: {error}</div>}
          {fileUrl && isImage && (
            <>
              <img src={fileUrl} alt="Archivo recibido" style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '6px', border: '1px solid var(--v2-border-soft)', display: 'block' }} />
              <div style={{ marginTop: '6px' }}>
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: 'var(--v2-primary)' }}>Abrir en pestaña nueva ↗</a>
              </div>
            </>
          )}
          {fileUrl && isPdf && (
            <>
              <embed src={fileUrl} type="application/pdf" style={{ width: '100%', height: '450px', borderRadius: '6px', border: '1px solid var(--v2-border-soft)' }} />
              <div style={{ marginTop: '6px' }}>
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: 'var(--v2-primary)' }}>Abrir en pestaña nueva ↗</a>
              </div>
            </>
          )}
          {fileUrl && !isImage && !isPdf && (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: 'var(--v2-primary)' }}>Descargar archivo ↗</a>
          )}
        </div>

        {/* Conversación (contexto para juzgar) */}
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginBottom: '6px' }}>💬 Conversación</div>
          <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--v2-border-soft)', borderRadius: '6px', padding: '8px', background: 'var(--v2-bg-soft)' }}>
            {convMsgs === null && <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>Cargando…</div>}
            {convMsgs !== null && convMsgs.length === 0 && <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>Sin mensajes.</div>}
            {convMsgs?.map((msg, i) => {
              const fromPatient = msg.role === 'patient'
              return (
                <div key={i} style={{ marginBottom: '8px', textAlign: fromPatient ? 'left' : 'right' }}>
                  <div style={{ fontSize: '9px', color: 'var(--v2-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {fromPatient ? 'Paciente' : (msg.role === 'staff' ? 'Equipo' : 'Asistente')}
                  </div>
                  <div style={{ fontSize: '12px', display: 'inline-block', maxWidth: '90%', padding: '5px 8px', borderRadius: '6px', background: fromPatient ? 'var(--v2-bg)' : 'var(--v2-primary-soft, #eef2ff)', textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {msg.content}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Acciones */}
      {isAuthorization && ruledService && (
        <div style={{ marginBottom: '8px', padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '12px', color: '#92400e' }}>
          ⚠ Esta conversación menciona <strong>{ruledService}</strong>, que requiere agendamiento manual. Agéndala tú — el agente no puede agendar ese servicio.
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {isAuthorization && (
          ruledService ? (
            <>
              {/* Servicio con regla → "Agendar yo" primario; el agente deshabilitado */}
              <button
                onClick={() => setModalOpen(true)}
                disabled={reviewState !== 'idle' || isMarking}
                className="btn-v2-primary"
                style={{ fontSize: '12px', padding: '6px 14px' }}
              >
                🗓 Agendar yo
              </button>
              <button
                disabled
                title="El agente no puede agendar este servicio (requiere validación humana)"
                style={{ fontSize: '12px', padding: '6px 14px', background: 'none', border: '1px solid var(--v2-border-soft)', borderRadius: '6px', color: 'var(--v2-text-muted)', cursor: 'not-allowed', opacity: 0.55 }}
              >
                🤖 El agente agenda (no disponible)
              </button>
            </>
          ) : (
            <>
              {/* Sin regla → el agente agenda (primario); "Agendar yo" secundario */}
              <button
                onClick={handleApproveAgent}
                disabled={reviewState !== 'idle' || isMarking}
                className="btn-v2-primary"
                style={{ fontSize: '12px', padding: '6px 14px' }}
              >
                {isMarking ? 'Aprobando…' : '🤖 Aprobar — el agente agenda'}
              </button>
              <button
                onClick={() => setModalOpen(true)}
                disabled={reviewState !== 'idle' || isMarking}
                style={{ fontSize: '12px', padding: '6px 14px', background: 'none', border: '1px solid var(--v2-border-soft)', borderRadius: '6px', color: 'var(--v2-text)', cursor: 'pointer' }}
              >
                🗓 Agendar yo
              </button>
            </>
          )
        )}
        {isAuthorization && (
          <button
            onClick={() => setReviewState('rejecting')}
            disabled={reviewState !== 'idle' || isMarking}
            style={{ fontSize: '12px', padding: '6px 14px', background: 'none', border: '1px solid var(--v2-border-soft)', borderRadius: '6px', color: 'var(--v2-red)', cursor: 'pointer' }}
          >
            ✗ Rechazar
          </button>
        )}
        <button
          onClick={handleMarkReviewed}
          disabled={reviewState !== 'idle' || isMarking}
          style={{ fontSize: '12px', padding: '6px 14px', background: 'none', border: '1px solid var(--v2-border-soft)', borderRadius: '6px', color: 'var(--v2-text-muted)', cursor: 'pointer' }}
        >
          {isMarking ? 'Guardando…' : '✓ Marcar como revisado'}
        </button>
      </div>

      {reviewState === 'rejecting' && (
        <RejectForm
          mediaId={item.media_id}
          onDone={(note) => { setDoneNote(note); setReviewState('done') }}
          onCancel={() => setReviewState('idle')}
        />
      )}

      <AppointmentFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        doctors={doctors}
        prefillPatient={prefillPatient}
        minBookingAdvanceHours={minBookingAdvanceHours}
        onSaved={handleApprovedAndScheduled}
      />
    </div>
  )
}

function RejectForm({
  mediaId,
  onDone,
  onCancel,
}: {
  mediaId: string
  onDone: (note: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [reasonKey, setReasonKey] = useState<string>('')
  const [freeText, setFreeText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isOtra = reasonKey === 'otra'

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    setError(null)
    if (!reasonKey) { setError('Selecciona un motivo'); return }
    if (isOtra && freeText.trim().length < 10) { setError('Para "Otra", escribe el motivo (mínimo 10 caracteres)'); return }
    startTransition(async () => {
      const r = await rejectAuthorization({ mediaId, reasonKey, freeText: freeText.trim() || undefined })
      if (!r.ok) { setError(r.error ?? 'Error'); return }
      onDone(r.windowClosed
        ? '✗ Rechazada. La ventana de 24h está cerrada — el aviso automático no se envió; contacta a la paciente manualmente.'
        : '✗ Rechazada y aviso enviado a la paciente.')
    })
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '12px', padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#991b1b' }}>Rechazar — se avisa a la paciente</div>

      <label style={{ display: 'block', fontSize: '11px', color: 'var(--v2-text-muted)', marginBottom: '3px' }}>Motivo</label>
      <select value={reasonKey} onChange={(e) => setReasonKey(e.target.value)} style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--v2-border-soft)', borderRadius: '4px', fontSize: '12px', marginBottom: '8px' }}>
        <option value="">Seleccionar motivo…</option>
        {REJECT_REASONS.map((r) => (
          <option key={r.key} value={r.key}>{r.label}</option>
        ))}
      </select>

      <label style={{ display: 'block', fontSize: '11px', color: 'var(--v2-text-muted)', marginBottom: '3px' }}>
        {isOtra ? 'Mensaje a la paciente (obligatorio)' : 'Nota interna (opcional, no se envía)'}
      </label>
      <textarea
        rows={2}
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
        placeholder={isOtra ? 'Escribe el mensaje que verá la paciente…' : 'Nota para el equipo…'}
        style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--v2-border-soft)', borderRadius: '4px', fontSize: '12px', fontFamily: 'inherit' }}
      />

      {error && <div style={{ fontSize: '11px', color: 'var(--v2-red)', margin: '8px 0' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button type="submit" disabled={isPending} style={{ fontSize: '12px', padding: '5px 12px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {isPending ? 'Rechazando…' : 'Confirmar rechazo'}
        </button>
        <button type="button" onClick={onCancel} disabled={isPending} style={{ fontSize: '12px', padding: '5px 12px', background: 'none', border: '1px solid var(--v2-border-soft)', borderRadius: '4px', cursor: 'pointer' }}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
