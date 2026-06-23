// ============================================================
// Doctor Detail — Datos, horario, tipos de consulta, bloqueos
// Ruta: /dashboard/settings/doctors/[id]
// ============================================================

export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect, notFound } from 'next/navigation'
import { getConsultationTypes } from '@/app/actions/consultation-types'
import { getBlockedDatesForDoctor } from '@/app/actions/blocked-dates'
import { DoctorDetailClient } from '@/components/dashboard/doctors/doctor-detail'

export default async function DoctorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard/settings/clinic')

  const { data: doctor, error } = await supabaseAdmin
    .from('doctors')
    .select('*')
    .eq('id', id)
    .eq('clinic_id', session.clinicId)
    .single()

  if (error || !doctor) notFound()

  const [consultationTypes, blockedDates] = await Promise.all([
    getConsultationTypes(id),
    getBlockedDatesForDoctor(id),
  ])

  // Las actions de doctors + consultation-types usan checkWritePermission('whatsapp')
  // — no 'settings'. Ver CLAUDE.md sección "Permission gates en doctors".
  // Si el rol no tiene whatsapp.write, la UI debe mostrarse read-only.
  const canWrite = session.permissions.whatsapp?.write === true

  return (
    <DoctorDetailClient
      canWrite={canWrite}
      userRoleName={session.role.name}
      doctor={{
        id: doctor.id as string,
        name: doctor.name as string,
        specialty: (doctor.specialty as string) ?? null,
        phone: (doctor.phone as string) ?? null,
        email: (doctor.email as string) ?? null,
        is_active: (doctor.is_active as boolean) ?? true,
        agenda_closed: (doctor.agenda_closed as boolean) ?? false,
        agenda_closed_reason: (doctor.agenda_closed_reason as string) ?? null,
        agenda_closed_until: (doctor.agenda_closed_until as string) ?? null,
        schedule_type: ((doctor.schedule_type as string) ?? 'fixed') as 'fixed' | 'manual',
        manual_availability_message: (doctor.manual_availability_message as string) ?? null,
        working_hours: doctor.working_hours as Record<string, unknown> | null,
        created_at: doctor.created_at as string,
      }}
      consultationTypes={consultationTypes}
      blockedDates={blockedDates}
    />
  )
}
