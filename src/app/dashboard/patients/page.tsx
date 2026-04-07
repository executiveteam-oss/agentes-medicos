// ============================================================
// Directorio de pacientes — Carga todos, filtra client-side
// Ruta: /dashboard/patients
// ============================================================

export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { getRestrictedDoctorId, isDoctorUnlinked } from '@/lib/doctor-filter'
import { DoctorUnlinkedBanner } from '@/components/dashboard/doctor-unlinked-banner'
import { redirect } from 'next/navigation'
import { PatientsTable } from '@/components/dashboard/patients-table'

export default async function PatientsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorUnlinked(session)) return <DoctorUnlinkedBanner />

  const restrictDoctorId = getRestrictedDoctorId(session)

  let patients: { id: string; name: string; phone: string; eps: string | null; total_appointments: number; no_show_count: number }[]

  if (restrictDoctorId) {
    // Doctor role: solo pacientes que han tenido citas con este doctor
    const { data: aptPatientIds } = await supabaseAdmin
      .from('appointments')
      .select('patient_id')
      .eq('clinic_id', session.clinicId)
      .eq('doctor_id', restrictDoctorId)

    const uniquePatientIds = [...new Set((aptPatientIds ?? []).map((a) => a.patient_id).filter(Boolean))]

    if (uniquePatientIds.length === 0) {
      patients = []
    } else {
      const { data } = await supabaseAdmin
        .from('patients')
        .select('id, name, phone, eps, total_appointments, no_show_count')
        .eq('clinic_id', session.clinicId)
        .in('id', uniquePatientIds)
        .order('name', { ascending: true })
      patients = data ?? []
    }
  } else {
    const { data } = await supabaseAdmin
      .from('patients')
      .select('id, name, phone, eps, total_appointments, no_show_count')
      .eq('clinic_id', session.clinicId)
      .order('name', { ascending: true })
      .limit(500)
    patients = data ?? []
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Pacientes</h1>
        <p className="text-slate-500 text-sm">
          {restrictDoctorId ? 'Pacientes que han tenido citas contigo' : 'Directorio de pacientes del consultorio'}
        </p>
      </div>

      <PatientsTable initialPatients={patients} />
    </div>
  )
}
