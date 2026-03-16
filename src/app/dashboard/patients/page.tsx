// ============================================================
// Directorio de pacientes — Carga todos, filtra client-side
// Ruta: /dashboard/patients
// ============================================================

export const dynamic = 'force-dynamic'

import { getAllPatients } from '@/app/actions/all-patients'
import { PatientsTable } from '@/components/dashboard/patients-table'

export default async function PatientsPage() {
  const patients = await getAllPatients()

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Pacientes</h1>
        <p className="text-slate-500 text-sm">Directorio de pacientes del consultorio</p>
      </div>

      <PatientsTable initialPatients={patients} />
    </div>
  )
}
