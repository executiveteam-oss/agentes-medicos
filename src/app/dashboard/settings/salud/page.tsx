// ============================================================
// SALUD DE LA CONFIGURACIÓN — Tab de Configuración
//
// Contesta "¿qué va a contestar mal el agente por un dato que falta?".
// Es otra pregunta que la del checklist de activación (getSetupProgress), que
// contesta "¿terminaste de configurar?" y desaparece a los 3 días.
// ============================================================

export const dynamic = 'force-dynamic'

import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { analizarSaludDeConfiguracion } from '@/lib/clinic/salud-configuracion'
import { SaludConfiguracionPanel } from '@/components/dashboard/salud-configuracion-panel'

export default async function SaludConfiguracionPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const salud = await analizarSaludDeConfiguracion(session.clinicId)
  return <SaludConfiguracionPanel salud={salud} />
}
