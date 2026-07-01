// ============================================================
// Automatizaciones — landing page
// ============================================================

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { getSurveyConfig } from '@/app/actions/survey-config'
import { ClipboardCheck, Zap } from 'lucide-react'

export default async function AutomationsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const survey = await getSurveyConfig()

  // Estado del feature "Encuesta post-consulta" en 3 niveles
  let surveyStatus: { label: string; color: string; hint: string }
  if (!survey.featureFlagEnabled) {
    surveyStatus = {
      label: 'No disponible',
      color: '#94a3b8',
      hint: 'Feature en beta. Contactá a soporte para habilitarlo.',
    }
  } else if (!survey.config.enabled) {
    surveyStatus = {
      label: 'Desactivada',
      color: '#94a3b8',
      hint: 'Feature disponible pero apagada. Andá a la sub-página para activarla.',
    }
  } else if (!survey.config.form_url) {
    surveyStatus = {
      label: 'Incompleta',
      color: '#f59e0b',
      hint: 'Falta configurar la URL del formulario.',
    }
  } else {
    surveyStatus = {
      label: 'Activa',
      color: '#10b981',
      hint: 'Se envía la encuesta a las pacientes cuyas citas queden facturadas.',
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
      <div>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={18} /> Automatizaciones
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)', margin: '4px 0 0 0' }}>
          Mensajes automáticos que se envían por WhatsApp según eventos de la clínica.
        </p>
      </div>

      <Link
        href="/dashboard/settings/automations/survey"
        style={{
          display: 'block',
          padding: '16px',
          background: 'var(--v2-bg-card)',
          border: '1px solid var(--v2-border-soft)',
          borderRadius: 'var(--v2-radius-lg)',
          boxShadow: 'var(--v2-shadow-sm)',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: '#eff6ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ClipboardCheck size={18} color="#2563eb" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700 }}>Encuesta post-consulta</span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '10px',
                  background: `${surveyStatus.color}22`,
                  color: surveyStatus.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                }}
              >
                {surveyStatus.label}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--v2-text-muted)', margin: '0 0 4px 0' }}>
              Envía un link a tu formulario de satisfacción a las pacientes cuya cita quedó
              facturada. Se manda por WhatsApp usando una plantilla pre-aprobada.
            </p>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', margin: 0, fontStyle: 'italic' }}>
              {surveyStatus.hint}
            </p>
          </div>
        </div>
      </Link>

      <div
        style={{
          padding: '12px 14px',
          background: '#fefce8',
          border: '1px solid #fde68a',
          borderRadius: 'var(--v2-radius)',
          fontSize: '12px',
          color: '#78350f',
          display: 'flex',
          gap: '8px',
        }}
      >
        <span>🚧</span>
        <span>
          Más automatizaciones vienen en próximas versiones: recordatorio previo al parto,
          seguimiento post-quirúrgico, recordatorio de exámenes de control.
        </span>
      </div>
    </div>
  )
}
