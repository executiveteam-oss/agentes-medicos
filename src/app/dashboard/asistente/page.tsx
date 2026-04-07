// ============================================================
// Wrapper server para Asistente IA — feature gating
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getFeatureGate, isFeatureEnabled } from '@/lib/feature-gate'
import { FeatureLocked } from '@/components/dashboard/feature-locked'
import { AsistenteChat } from './asistente-chat'

export default async function AsistentePage() {
  const session = await getUserSession()
  if (!session) redirect('/login')

  const gate = await getFeatureGate(session.clinicId)
  if (!isFeatureEnabled(gate.config, 'ai_assistant')) {
    return (
      <FeatureLocked
        featureName="Asistente IA dashboard"
        featureDescription="Tu consultor IA interactivo dentro del dashboard — pregunta sobre citas, stats, cartera y recibe respuestas en tiempo real."
        whatsappMessage="quiero activar el Asistente IA dashboard"
        clinicName={session.clinic?.name}
        plusModuleName="Asistente IA dashboard"
        doctorCount={gate.expectedDoctors}
      />
    )
  }

  return <AsistenteChat />
}
