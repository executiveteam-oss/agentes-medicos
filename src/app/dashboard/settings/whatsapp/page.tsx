// ============================================================
// Settings → WhatsApp — Wizard de configuración de credenciales
// Ruta: /dashboard/settings/whatsapp
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { getWhatsAppCredentials } from '@/app/actions/whatsapp-credentials'
import { WhatsAppSetupWizard } from './whatsapp-setup-wizard'

export default async function WhatsAppSettingsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const credentials = await getWhatsAppCredentials()

  return <WhatsAppSetupWizard initialCredentials={credentials} />
}
