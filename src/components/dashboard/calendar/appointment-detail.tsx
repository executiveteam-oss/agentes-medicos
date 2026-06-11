// ============================================================
// AppointmentDetail v2 — Inline expand for day/week views
// ============================================================

import { formatTimeForPatient, formatDateForPatient, formatPhone } from '@/lib/utils/dates'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { CancelAppointmentButton } from '@/components/dashboard/dashboard-actions'
import type { CalendarAppointment, CalendarDoctor } from './types'
import { STATUS_LABELS, STATUS_STYLES } from './types'
import type { AppointmentStatus } from '@/types/database'

interface Props {
  appointment: CalendarAppointment
  onClose: () => void
}

export function AppointmentDetail({ appointment: apt, onClose }: Props) {
  const patient = apt.patient
  const doctor = apt.doctor
  const st = STATUS_STYLES[apt.status] ?? STATUS_STYLES.confirmed
  const probability = patient?.no_show_probability ?? 0

  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--v2-primary-tint)',
        borderLeft: '3px solid var(--v2-primary)',
        fontFamily: 'var(--font-manrope), sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v2-text)', textTransform: 'capitalize' }}>
            {formatDateForPatient(apt.starts_at)} &middot; {formatTimeForPatient(apt.starts_at)} — {formatTimeForPatient(apt.ends_at)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
            {doctor && <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--v2-text-muted)' }}>{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ''}</span>}
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>{patient?.name ?? apt.reason ?? 'Paciente'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: st.bg, color: st.fg }}>
            {STATUS_LABELS[apt.status] ?? apt.status}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-text-subtle)', padding: '4px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Info grid */}
      {patient && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', fontSize: '12px', marginBottom: '12px' }}>
          <InfoItem label="Teléfono" value={formatPhone(patient.phone)} />
          <InfoItem label="Documento" value={`${patient.document_type} ${patient.document_number ?? '-'}`} />
          <InfoItem label="Motivo" value={apt.reason ?? 'No especificado'} />
          <InfoItem label="Recordatorio"
            value={apt.reminder_confirmed === true ? 'Confirmo' : apt.reminder_confirmed === false ? 'No confirmo' : apt.reminder_24h_sent ? 'Enviado' : 'No enviado'}
            valueColor={apt.reminder_confirmed === true ? 'var(--v2-green-deep)' : apt.reminder_confirmed === false ? 'var(--v2-red)' : undefined}
          />
          <InfoItem label="Tipo pago" value={apt.payment_type} />
          <InfoItem label="Historial" value={`${patient.total_appointments} citas, ${patient.no_show_count} no-shows`} />
          <InfoItem label="Riesgo"
            value={`${probability}%`}
            valueColor={probability > 40 ? 'var(--v2-red)' : probability > 20 ? '#b07d00' : 'var(--v2-green-deep)'}
          />
          {apt.modality === 'virtual' && <InfoItem label="Modalidad" value="Virtual" valueColor="var(--v2-primary)" />}
        </div>
      )}

      {/* Free text reason */}
      {apt.free_text_reason && (
        <div style={{ padding: '10px 14px', background: 'var(--v2-primary-soft)', borderRadius: 'var(--v2-radius)', marginBottom: '10px' }}>
          <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--v2-primary)', marginBottom: '4px' }}>Motivo del paciente</p>
          <p style={{ fontSize: '12px', color: 'var(--v2-text)' }}>{apt.free_text_reason}</p>
        </div>
      )}

      {/* Doctor notes */}
      {patient?.doctor_notes && (
        <div style={{ padding: '10px 14px', background: 'var(--v2-bg-soft)', borderRadius: 'var(--v2-radius)', marginBottom: '10px' }}>
          <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--v2-text-subtle)', marginBottom: '4px' }}>Notas del doctor</p>
          <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>{patient.doctor_notes}</p>
        </div>
      )}

      {/* Virtual link */}
      {apt.modality === 'virtual' && apt.virtual_link && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--v2-primary-soft)', borderRadius: '8px', marginBottom: '10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--v2-primary)' }}>Link:</span>
          <a href={apt.virtual_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: 'var(--v2-primary)', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis' }}>{apt.virtual_link}</a>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
        <QuickActions appointmentId={apt.id} currentStatus={apt.status as AppointmentStatus} attendanceOutcome={apt.attendance_outcome} />
      </div>
      {(apt.status === 'confirmed' || apt.status === 'rescheduled') && (
        <CancelAppointmentButton appointmentId={apt.id} />
      )}
    </div>
  )
}

function InfoItem({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <p style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--v2-text-subtle)', marginBottom: '2px' }}>{label}</p>
      <p style={{ fontSize: '12px', fontWeight: 600, color: valueColor ?? 'var(--v2-text)' }}>{value}</p>
    </div>
  )
}
