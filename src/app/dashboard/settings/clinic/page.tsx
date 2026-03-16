// ============================================================
// Configuración del consultorio — Tab 1
// ============================================================

export const dynamic = 'force-dynamic'

import { getClinicSettings } from '@/app/actions/clinic'
import { ClinicSettingsForm } from './clinic-settings-form'

export default async function ClinicSettingsPage() {
  const data = await getClinicSettings()

  return (
    <ClinicSettingsForm
      initialData={data ?? {
        name: '',
        phone: '',
        contact_email: '',
        website: '',
        specialty: [],
        consultation_price: null,
        daily_goal_appointments: 10,
        address: '',
        city: 'Pereira',
        department: 'Risaralda',
        building: '',
        floor: '',
        office: '',
        logo_url: '',
      }}
    />
  )
}
