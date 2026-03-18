// ============================================================
// Directorio de pacientes — Carga todos, filtra client-side
// Ruta: /dashboard/patients
// ============================================================

export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { PatientsTable } from '@/components/dashboard/patients-table'

export default async function PatientsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')

  const { data: patients } = await supabaseAdmin
    .from('patients')
    .select('id, name, phone, eps, total_appointments, no_show_count')
    .eq('clinic_id', session.clinicId)
    .order('name', { ascending: true })
    .limit(500)

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Pacientes</h1>
        <p className="text-slate-500 text-sm">Directorio de pacientes del consultorio</p>
      </div>

      <PatientsTable initialPatients={patients ?? []} />
    </div>
  )
}
