// ============================================================
// PÁGINA CARTERA — Deudas pendientes y gestión de cobros
// Ruta: /dashboard/cartera
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { CarteraPanel } from '@/components/dashboard/cartera-panel'
import { redirect } from 'next/navigation'
import type { CarteraEntryWithDetails } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function CarteraPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard')

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('id, name')
    .eq('id', session.clinicId)
    .single()

  if (!clinic) {
    return (
      <div className="p-6 lg:p-8">
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">🏥</p>
          <p className="text-slate-900 font-medium">No hay clínica configurada</p>
        </div>
      </div>
    )
  }

  // Cartera pendiente con datos de paciente
  const { data: cartera } = await supabaseAdmin
    .from('cartera')
    .select('*, patients(name, phone, email, no_show_count, total_appointments)')
    .eq('clinic_id', clinic.id)
    .eq('status', 'pendiente')
    .order('days_overdue', { ascending: false })

  const entries = (cartera ?? []).map((row) => {
    const { patients: patientData, ...rest } = row as Record<string, unknown>
    return {
      ...rest,
      patient: patientData ?? { name: 'Desconocido', phone: '', email: null, no_show_count: 0, total_appointments: 0 },
    }
  }) as CarteraEntryWithDetails[]

  const totalDeuda = entries.reduce((sum, e) => sum + e.amount, 0)
  const totalVencida30 = entries
    .filter((e) => e.days_overdue > 30)
    .reduce((sum, e) => sum + e.amount, 0)
  const countPacientes = new Set(entries.map((e) => e.patient_id)).size

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Cartera</h1>
        <p className="text-slate-500 text-sm">Deudas pendientes de cobro</p>
      </div>

      <CarteraPanel
        entries={entries}
        totalDeuda={totalDeuda}
        totalVencida30={totalVencida30}
        countPacientes={countPacientes}
      />
    </div>
  )
}
