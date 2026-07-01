// ============================================================
// Encuesta post-consulta — Configuración
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { getSurveyConfig } from '@/app/actions/survey-config'
import { SurveyForm } from './survey-form'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export default async function SurveyPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const canWrite = session.permissions.settings?.write === true
  const { config, featureFlagEnabled, clinicName } = await getSurveyConfig()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
      <Link
        href="/dashboard/settings/automations"
        style={{
          fontSize: '12px',
          color: 'var(--v2-text-muted)',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          width: 'fit-content',
        }}
      >
        <ChevronLeft size={14} /> Volver a Automatizaciones
      </Link>

      <div>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Encuesta post-consulta</h1>
        <p style={{ fontSize: '13px', color: 'var(--v2-text-muted)', margin: '4px 0 0 0' }}>
          Se envía por WhatsApp a las pacientes cuya cita queda marcada como <strong>Facturada</strong>. Usa una plantilla
          pre-aprobada por Meta con un botón que abre tu formulario.
        </p>
      </div>

      <SurveyForm
        initialConfig={config}
        featureFlagEnabled={featureFlagEnabled}
        clinicName={clinicName}
        canWrite={canWrite}
      />
    </div>
  )
}
