// ============================================================
// PÁGINA LISTA DE ESPERA — Pacientes esperando un espacio
// Ruta: /dashboard/espera
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { EsperaPanel } from '@/components/dashboard/espera-panel'

export const dynamic = 'force-dynamic'

export default async function EsperaPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')

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

  // Datos en paralelo
  const [waitlistRes, doctorsRes] = await Promise.all([
    supabaseAdmin
      .from('waitlist')
      .select('*, patients(name, phone), doctors(name)')
      .eq('clinic_id', clinic.id)
      .in('status', ['waiting', 'notified'])
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('doctors')
      .select('id, name, specialty')
      .eq('clinic_id', clinic.id)
      .eq('is_active', true)
      .order('name'),
  ])

  const entries = (waitlistRes.data ?? []) as Array<{
    id: string; preferred_dates: string[]; preferred_time: string
    reason: string | null; priority: 'normal' | 'urgente'; status: string
    notified_at: string | null; created_at: string
    patients: { name: string; phone: string } | null
    doctors: { name: string } | null
  }>

  const doctors = (doctorsRes.data ?? []) as Array<{
    id: string; name: string; specialty: string | null
  }>

  const esperando = entries.filter((e) => e.status === 'waiting').length
  const notificados = entries.filter((e) => e.status === 'notified').length

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Lista de Espera</h1>
        <p className="text-slate-500 text-sm">Pacientes esperando un espacio disponible</p>
      </div>

      <EsperaPanel
        entries={entries}
        doctors={doctors}
        esperando={esperando}
        notificados={notificados}
      />
    </div>
  )
}
