// ============================================================
// Doctores — Lista de médicos de la clínica
// Ruta: /dashboard/settings/doctors
// ============================================================

export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { DoctorsListClient } from '@/components/dashboard/doctors/doctors-list'

export default async function DoctorsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const { data: doctors } = await supabaseAdmin
    .from('doctors')
    .select('id, name, specialty, phone, email, is_active, agenda_closed, agenda_closed_reason, agenda_closed_until, schedule_type, created_at')
    .eq('clinic_id', session.clinicId)
    .order('name')

  // Count consultation types and future appointments per doctor
  const doctorList = await Promise.all(
    (doctors ?? []).map(async (doc) => {
      const [ctRes, aptRes] = await Promise.all([
        supabaseAdmin.from('consultation_types').select('id', { count: 'exact', head: true }).eq('doctor_id', doc.id),
        supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('doctor_id', doc.id).gte('starts_at', new Date().toISOString()).in('status', ['confirmed', 'rescheduled']),
      ])
      return {
        ...doc,
        consultation_type_count: ctRes.count ?? 0,
        future_appointments: aptRes.count ?? 0,
      }
    })
  )

  const activeCount = doctorList.filter((d) => d.is_active && !d.agenda_closed).length

  return (
    <DoctorsListClient
      doctors={doctorList}
      activeCount={activeCount}
    />
  )
}
