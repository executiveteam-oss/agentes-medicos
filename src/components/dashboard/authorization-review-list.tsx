'use client'

// ============================================================
// AuthorizationReviewList — Bloque 4
//
// Lista de autorizaciones pendientes con preview inline del archivo
// (imagen visible / PDF embed) + botones Aprobar/Rechazar.
//
// Cada acceso al archivo genera una URL firmada con TTL 10 min Y
// queda registrado en audit_log (cada acceso, no resumido).
// ============================================================

import { useState, useTransition, useEffect } from 'react'
import {
  getAuthorizationFileUrl,
  approveAuthorizationAndCreateAppointment,
  rejectAuthorization,
  type PendingAuthorization,
} from '@/app/actions/authorization-review'

export function AuthorizationReviewList({
  items,
}: {
  items: PendingAuthorization[]
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {items.map((item) => (
        <AuthorizationCard key={item.media_id} item={item} />
      ))}
    </div>
  )
}

function AuthorizationCard({ item }: { item: PendingAuthorization }): React.JSX.Element {
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [loadingUrl, setLoadingUrl] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewState, setReviewState] = useState<'idle' | 'approving' | 'rejecting' | 'done'>('idle')

  useEffect(() => {
    let mounted = true
    setLoadingUrl(true)
    getAuthorizationFileUrl(item.media_id).then((r) => {
      if (!mounted) return
      if (r.ok && r.url) setFileUrl(r.url)
      else setError(r.error ?? 'Error cargando archivo')
      setLoadingUrl(false)
    }).catch((e) => {
      if (mounted) {
        setError(String(e))
        setLoadingUrl(false)
      }
    })
    return () => { mounted = false }
  }, [item.media_id])

  const isImage = item.mime_type?.startsWith('image/') ?? false
  const isPdf = item.mime_type === 'application/pdf'

  if (reviewState === 'done') {
    return (
      <div className="card-v2" style={{ padding: '16px', opacity: 0.6 }}>
        <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)' }}>
          ✓ Revisado — se actualizará la lista al recargar la página.
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
            <div style={{ fontSize: '14px', fontWeight: 600 }}>
              {item.patient_name ?? 'Paciente sin nombre'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>
              {item.patient_phone}
            </div>
            {item.conversation_escalation_reason && (
              <div style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
                {item.conversation_escalation_reason}
              </div>
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--v2-text-muted)' }}>
            Recibido: {new Date(item.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
          </div>
        </div>
      </div>

      {/* Preview del archivo */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginBottom: '6px' }}>
          📎 {item.filename ?? (isPdf ? 'documento.pdf' : 'imagen')} ({item.mime_type})
          {item.size_bytes && ` — ${Math.round(item.size_bytes / 1024)}KB`}
        </div>
        {loadingUrl && <div style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>Cargando archivo…</div>}
        {error && <div style={{ fontSize: '12px', color: 'var(--v2-red)' }}>Error: {error}</div>}
        {fileUrl && isImage && (
          <img
            src={fileUrl}
            alt="Autorización"
            style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '6px', border: '1px solid var(--v2-border-soft)' }}
          />
        )}
        {fileUrl && isPdf && (
          <>
            <embed src={fileUrl} type="application/pdf" style={{ width: '100%', height: '450px', borderRadius: '6px', border: '1px solid var(--v2-border-soft)' }} />
            <div style={{ marginTop: '6px' }}>
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: 'var(--v2-primary)' }}>
                Abrir en pestaña nueva ↗
              </a>
            </div>
          </>
        )}
        {fileUrl && !isImage && !isPdf && (
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: 'var(--v2-primary)' }}>
            Descargar archivo ↗
          </a>
        )}
      </div>

      {/* Botones */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => setReviewState('approving')}
          disabled={reviewState !== 'idle'}
          className="btn-v2-primary"
          style={{ fontSize: '12px', padding: '6px 14px' }}
        >
          ✓ Aprobar y agendar
        </button>
        <button
          onClick={() => setReviewState('rejecting')}
          disabled={reviewState !== 'idle'}
          style={{
            fontSize: '12px',
            padding: '6px 14px',
            background: 'none',
            border: '1px solid var(--v2-border-soft)',
            borderRadius: '6px',
            color: 'var(--v2-red)',
            cursor: 'pointer',
          }}
        >
          ✗ Rechazar
        </button>
      </div>

      {reviewState === 'approving' && (
        <ApproveForm
          mediaId={item.media_id}
          patientId={null}
          onDone={() => setReviewState('done')}
          onCancel={() => setReviewState('idle')}
          conversationId={item.conversation_id}
        />
      )}
      {reviewState === 'rejecting' && (
        <RejectForm
          mediaId={item.media_id}
          onDone={() => setReviewState('done')}
          onCancel={() => setReviewState('idle')}
        />
      )}
    </div>
  )
}

function ApproveForm({
  mediaId,
  conversationId,
  onDone,
  onCancel,
}: {
  mediaId: string
  patientId: string | null
  conversationId: string
  onDone: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [doctorId, setDoctorId] = useState('')
  const [ctId, setCtId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [duration, setDuration] = useState('30')
  const [patientId, setPatientId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    setError(null)
    if (!doctorId || !ctId || !startsAt || !patientId) {
      setError('Faltan datos requeridos')
      return
    }
    startTransition(async () => {
      const r = await approveAuthorizationAndCreateAppointment({
        mediaId,
        doctorId,
        consultationTypeId: ctId,
        startsAt: new Date(startsAt).toISOString(),
        durationMinutes: parseInt(duration, 10),
        patientId,
        reviewNotes: notes,
      })
      if (!r.ok) { setError(r.error ?? 'Error'); return }
      onDone()
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ marginTop: '12px', padding: '12px', background: 'var(--v2-bg-soft)', borderRadius: '6px' }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>Aprobar y crear cita</div>
      <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginBottom: '12px' }}>
        Confirmá los datos de la cita. Conversación: {conversationId.slice(0, 8)}…
      </p>

      <FormField label="Patient ID (UUID)">
        <input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="UUID del paciente" style={inputStyle} />
      </FormField>
      <FormField label="Doctor ID">
        <input value={doctorId} onChange={(e) => setDoctorId(e.target.value)} placeholder="UUID del doctor" style={inputStyle} />
      </FormField>
      <FormField label="Tipo de consulta ID">
        <input value={ctId} onChange={(e) => setCtId(e.target.value)} placeholder="UUID del CT" style={inputStyle} />
      </FormField>
      <FormField label="Inicio (datetime local)">
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={inputStyle} />
      </FormField>
      <FormField label="Duración (min)">
        <input type="number" min={5} max={240} value={duration} onChange={(e) => setDuration(e.target.value)} style={inputStyle} />
      </FormField>
      <FormField label="Notas (opcional)">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
      </FormField>

      {error && <div style={{ fontSize: '11px', color: 'var(--v2-red)', marginBottom: '8px' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" disabled={isPending} className="btn-v2-primary" style={{ fontSize: '12px', padding: '5px 12px' }}>
          {isPending ? 'Creando…' : 'Crear cita'}
        </button>
        <button type="button" onClick={onCancel} disabled={isPending} style={{ fontSize: '12px', padding: '5px 12px', background: 'none', border: '1px solid var(--v2-border-soft)', borderRadius: '4px', cursor: 'pointer' }}>
          Cancelar
        </button>
      </div>

      <p style={{ fontSize: '10px', color: 'var(--v2-text-muted)', marginTop: '8px' }}>
        ⚠ UI de v1 — los IDs se ingresan a mano. En siguiente iteración: dropdowns de paciente, doctor y CT desde la conversación.
      </p>
    </form>
  )
}

function RejectForm({
  mediaId,
  onDone,
  onCancel,
}: {
  mediaId: string
  onDone: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    setError(null)
    if (notes.trim().length < 10) {
      setError('Motivo del rechazo es obligatorio (mínimo 10 caracteres)')
      return
    }
    startTransition(async () => {
      const r = await rejectAuthorization({ mediaId, reviewNotes: notes.trim() })
      if (!r.ok) { setError(r.error ?? 'Error'); return }
      onDone()
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ marginTop: '12px', padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px' }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#991b1b' }}>Rechazar autorización</div>
      <FormField label="Motivo (obligatorio, mínimo 10 caracteres)">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: La autorización no está direccionada a la clínica" style={inputStyle} />
      </FormField>
      {error && <div style={{ fontSize: '11px', color: 'var(--v2-red)', marginBottom: '8px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px' }}>
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

function FormField({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: '8px' }}>
      <label style={{ display: 'block', fontSize: '11px', color: 'var(--v2-text-muted)', marginBottom: '3px' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  border: '1px solid var(--v2-border-soft)',
  borderRadius: '4px',
  fontSize: '12px',
  fontFamily: 'inherit',
}
