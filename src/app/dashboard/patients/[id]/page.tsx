// ============================================================
// Detalle de paciente v2 — Hero + KPIs + Tabs
// Ruta: /dashboard/patients/[id]
// ============================================================

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPatientDetail } from '@/app/actions/patients'
import { formatFrequency } from '@/app/actions/reactivation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { PatientDetailV2 } from '@/components/dashboard/patient-detail-v2'
import { redirect } from 'next/navigation'

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getUserSession()
  if (!session) redirect('/login')

  const result = await getPatientDetail(id)
  if (!result) notFound()

  const { patient, appointments, conversations } = result

  // Get doctor with most appointments
  const doctorCounts: Record<string, { name: string; count: number }> = {}
  for (const a of appointments) {
    if (a.doctor_name) {
      if (!doctorCounts[a.doctor_name]) doctorCounts[a.doctor_name] = { name: a.doctor_name, count: 0 }
      doctorCounts[a.doctor_name].count++
    }
  }
  const topDoctor = Object.values(doctorCounts).sort((a, b) => b.count - a.count)[0] ?? null

  // Check for existing conversation
  const { data: lastConv } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('clinic_id', session.clinicId)
    .eq('patient_id', id)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const conversationId = lastConv?.id as string | null

  // Frequency label
  const frequencyLabel = patient.visit_frequency_days ? await formatFrequency(patient.visit_frequency_days) : null

  return (
    <PatientDetailV2
      patient={patient}
      appointments={appointments}
      conversations={conversations}
      topDoctorName={topDoctor?.name ?? null}
      conversationId={conversationId}
      frequencyLabel={frequencyLabel}
    />
  )
}
