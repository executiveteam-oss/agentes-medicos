// ============================================================
// AppointmentDetail v2 — Inline expand for day/week views
// ============================================================

import { formatTimeForPatient, formatDateForPatient, formatPhone } from '@/lib/utils/dates'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { CancelAppointmentButton } from '@/components/dashboard/dashboard-actions'
import type { CalendarAppointment, CalendarDoctor } from './types'
import { STATUS_STYLES, etiquetaEstado, esCupoCompartido } from './types'
import type { AppointmentStatus } from '@/types/database'
import { motivoEsElNombre, parsearEntidadISalud } from '@/lib/isalud/servicio-cita'

export interface SurveyPropsForQuickActions {
  enabled: boolean
  form_url: string | null
  clinic_display_name: string
  /** Hay config guardada pero mal formada. Ver getSurveyConfig. */
  malformed?: boolean
}

interface Props {
  appointment: CalendarAppointment
  onClose: () => void
  surveyConfig?: SurveyPropsForQuickActions
}

export function AppointmentDetail({ appointment: apt, onClose, surveyConfig }: Props) {
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
            {etiquetaEstado(apt.status, apt.reason)}
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
          {/* Tipo de consulta: el dato principal de la cita.
              Cae al texto que manda iSalud cuando la cita no está vinculada al
              catálogo — el 22% de las importadas, porque el mismo procedimiento
              existe en varias filas y elegir una fabricaría un precio. El texto
              sin fila es útil igual: dice qué le van a hacer a la paciente, que
              era exactamente lo que faltaba. */}
          <InfoItem
            label="Tipo de consulta"
            value={apt.consultation_type_name || apt.external_service_name || 'Sin especificar'}
            valueColor={(apt.consultation_type_name || apt.external_service_name) ? undefined : 'var(--v2-text-subtle)'}
          />
          {/* Motivo solo si existe Y aporta algo. El import llena `reason` con el
              NOMBRE de la paciente cuando no tiene otra cosa, así que el panel
              mostraba "Motivo: LUISA FERNANDA MONTOYA" debajo de su propio
              nombre. Mismo criterio que ya se aplicó para ocultar el vacío. */}
          {apt.reason && !motivoEsElNombre(apt.reason, patient?.name) && (
            <InfoItem label="Motivo" value={apt.reason} />
          )}
          <InfoItem label="Recordatorio"
            value={apt.reminder_confirmed === true ? 'Confirmo' : apt.reminder_confirmed === false ? 'No confirmo' : apt.reminder_24h_sent ? 'Enviado' : 'No enviado'}
            valueColor={apt.reminder_confirmed === true ? 'var(--v2-green-deep)' : apt.reminder_confirmed === false ? 'var(--v2-red)' : undefined}
          />
          {/* iSalud manda entidad, régimen y tipo de afiliado PEGADOS sin
              separador: "PARTICULARRégimen: ParticularTipo afiliado: Cotizante".
              Los marcadores son literales y constantes (verificado sobre las
              2.904 citas importadas), así que se pueden separar sin adivinar. */}
          {(() => {
            const p = parsearEntidadISalud(apt.external_aseguradora)
            const entidad = p?.entidad || patient.entidad || null
            return (
              <>
                <InfoItem label="Entidad" value={entidad ?? 'Sin registrar'} valueColor={entidad ? undefined : 'var(--v2-text-subtle)'} />
                {p?.regimen && <InfoItem label="Régimen" value={p.regimen} />}
                {p?.tipoAfiliado && <InfoItem label="Tipo de afiliado" value={p.tipoAfiliado} />}
              </>
            )
          })()}
          {/* Tipo pago SOLO en citas del agente. En las importadas y las que carga
              la secretaria es el DEFAULT 'Particular' de la columna, que nadie escribe:
              decía "Particular" al lado de una entidad de prepagada y se contradecían
              en pantalla. Un dato inventado es peor que un dato ausente. */}
          {apt.source === 'whatsapp_agent' && apt.payment_type && (
            <InfoItem label="Tipo pago" value={apt.payment_type} />
          )}
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

      {/* Cupo compartido: QuickActions devuelve null para blocked_external, así que
          sin este aviso el panel se veía como una cita normal a la que le faltan los
          botones — y nadie podía saber por qué. */}
      {esCupoCompartido(apt.status, apt.reason) && (
        <div style={{ padding: '10px 12px', borderRadius: '8px', marginTop: '8px',
                      background: 'var(--v2-pink-soft)', border: '1px solid var(--v2-pink)' }}>
          <p style={{ fontSize: '11.5px', fontWeight: 700, color: '#a3306b' }}>Cupo compartido con otra cita</p>
          <p style={{ fontSize: '11px', color: '#a3306b', marginTop: '3px', lineHeight: 1.4 }}>
            En iSalud hay otra cita a la misma hora con este médico. La paciente es real y el
            horario es el correcto, pero desde acá no se le puede marcar asistencia ni enviar
            la encuesta. Para eso, gestionala en iSalud.
          </p>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
        <QuickActions
          appointmentId={apt.id}
          currentStatus={apt.status as AppointmentStatus}
          attendanceOutcome={apt.attendance_outcome}
          surveyState={{
            sent: apt.survey_sent,
            sentAt: apt.survey_sent_at,
            patientFirstName: apt.patient?.first_name ?? apt.patient?.name ?? null,
            patientPhone: apt.patient?.phone ?? null,
          }}
          surveyConfig={surveyConfig ?? null}
          documentsRequested={apt.documents_requested}
          documentsReceived={apt.documents_received}
        />
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
