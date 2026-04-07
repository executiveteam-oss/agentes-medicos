// ============================================================
// PÁGINA LISTA DE ESPERA — Pacientes esperando un espacio
// Ruta: /dashboard/espera
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { isDoctorRole } from '@/lib/doctor-filter'
import { redirect } from 'next/navigation'
import { EsperaPanel } from '@/components/dashboard/espera-panel'
import { calculateWaitlistPriorities } from '@/app/actions/priority'
import { getFeatureGate, isFeatureEnabled } from '@/lib/feature-gate'
import { FeatureLocked } from '@/components/dashboard/feature-locked'

export const dynamic = 'force-dynamic'

export default async function EsperaPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')
  if (isDoctorRole(session)) redirect('/dashboard')

  const gate = await getFeatureGate(session.clinicId)
  if (!isFeatureEnabled(gate.config, 'waitlist')) {
    return (
      <FeatureLocked
        featureName="Lista de espera activa"
        featureDescription="Cuando cancela alguien, el siguiente en espera recibe aviso automático en segundos. Cupos siempre llenos."
        whatsappMessage="quiero activar la Lista de espera activa"
        clinicName={session.clinic?.name}
      />
    )
  }

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
  const [waitlistRes, doctorsRes, priorityData] = await Promise.all([
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
    calculateWaitlistPriorities(clinic.id),
  ])

  const entries = (waitlistRes.data ?? []) as Array<{
    id: string; patient_id: string; preferred_dates: string[]; preferred_time: string
    reason: string | null; priority: 'normal' | 'urgente'; status: string
    notified_at: string | null; created_at: string
    source: string; preferred_schedule_notes: string | null; consultation_type_name: string | null
    patients: { name: string; phone: string } | null
    doctors: { name: string } | null
  }>

  const doctors = (doctorsRes.data ?? []) as Array<{
    id: string; name: string; specialty: string | null
  }>

  // Separar entradas normales de solicitudes manuales de WhatsApp
  const regularEntries = entries.filter((e) => e.source !== 'whatsapp')
  const manualEntries = entries.filter((e) => e.source === 'whatsapp')

  const esperando = regularEntries.filter((e) => e.status === 'waiting').length
  const notificados = regularEntries.filter((e) => e.status === 'notified').length

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Lista de Espera</h1>
        <p className="text-slate-500 text-sm">Pacientes esperando un espacio disponible</p>
      </div>

      <EsperaPanel
        entries={regularEntries}
        manualEntries={manualEntries}
        doctors={doctors}
        esperando={esperando}
        notificados={notificados}
        priorityScores={priorityData.scores}
        availableSlotsThisWeek={priorityData.availableSlotsThisWeek}
        waitlistCount={priorityData.waitlistCount}
      />
    </div>
  )
}
