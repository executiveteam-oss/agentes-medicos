// ============================================================
// Pacientes v2 — Directorio de pacientes
// Ruta: /dashboard/patients
// ============================================================

export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { getRestrictedDoctorId, isDoctorUnlinked } from '@/lib/doctor-filter'
import { DoctorUnlinkedBanner } from '@/components/dashboard/doctor-unlinked-banner'
import { redirect } from 'next/navigation'
import { PatientsListV2 } from '@/components/dashboard/patients-list-v2'

export default async function PatientsPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorUnlinked(session)) return <DoctorUnlinkedBanner />

  const restrictDoctorId = getRestrictedDoctorId(session)

  type RawPatient = {
    id: string; name: string; phone: string; eps: string | null
    entidad: string | null; tratantes: Record<string, { doctor_id: string }> | null
    total_appointments: number; no_show_count: number; created_at: string
  }
  const SELECT_COLS = 'id, name, phone, eps, entidad, tratantes, total_appointments, no_show_count, created_at'
  let rawPatients: RawPatient[]

  if (restrictDoctorId) {
    const { data: aptPatientIds } = await supabaseAdmin
      .from('appointments')
      .select('patient_id')
      .eq('clinic_id', session.clinicId)
      .eq('doctor_id', restrictDoctorId)

    const uniqueIds = [...new Set((aptPatientIds ?? []).map((a) => a.patient_id).filter(Boolean))]

    if (uniqueIds.length === 0) {
      rawPatients = []
    } else {
      const { data } = await supabaseAdmin
        .from('patients')
        .select(SELECT_COLS)
        .eq('clinic_id', session.clinicId)
        .in('id', uniqueIds)
        .order('name', { ascending: true })
      rawPatients = (data ?? []) as RawPatient[]
    }
  } else {
    const { data } = await supabaseAdmin
      .from('patients')
      .select(SELECT_COLS)
      .eq('clinic_id', session.clinicId)
      .order('name', { ascending: true })
      .limit(500)
    rawPatients = (data ?? []) as RawPatient[]
  }

  // Resolver doctor_id → nombre para mostrar el tratante (jsonb tratantes por especialidad)
  const { data: docs } = await supabaseAdmin
    .from('doctors')
    .select('id, name')
    .eq('clinic_id', session.clinicId)
  const doctorNameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]))

  const patients = rawPatients.map((p) => {
    const names = [...new Set(
      Object.values(p.tratantes ?? {})
        .map((t) => doctorNameById.get(t.doctor_id))
        .filter((n): n is string => Boolean(n)),
    )]
    return {
      id: p.id, name: p.name, phone: p.phone, eps: p.eps,
      entidad: p.entidad, tratante_names: names,
      total_appointments: p.total_appointments, no_show_count: p.no_show_count, created_at: p.created_at,
    }
  })

  // Count active this month
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const activeThisMonth = patients.filter((p) => new Date(p.created_at) >= monthStart).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h1
            className="text-2xl sm:text-3xl"
            style={{ fontWeight: 800, fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--v2-text)', letterSpacing: '-0.02em' }}
          >
            Tus{' '}
            <span
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: 'italic',
                fontWeight: 400,
                background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-pink))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              pacientes
            </span>
          </h1>
          <p style={{ fontSize: '13.5px', color: 'var(--v2-text-muted)', marginTop: '4px', fontFamily: 'var(--font-manrope), sans-serif' }}>
            {patients.length} registrados
            {restrictDoctorId ? ' (tus pacientes)' : ` · ${activeThisMonth} nuevos este mes`}
          </p>
        </div>
      </div>

      <PatientsListV2 initialPatients={patients} />
    </div>
  )
}
