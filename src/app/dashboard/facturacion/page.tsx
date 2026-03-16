// ============================================================
// PÁGINA FACTURACIÓN — Control diario de facturación
// Ruta: /dashboard/facturacion
// Secciones: Pendientes de facturar + Facturas del mes + Resumen
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getUserSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { FacturacionPanel } from '@/components/dashboard/facturacion-panel'
import type { CollectionStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function FacturacionPage() {
  const session = await getUserSession()
  if (!session) redirect('/login')

  const clinicId = session.clinicId

  // Precio por defecto de la clínica
  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('consultation_price')
    .eq('id', clinicId)
    .single()

  const defaultPrice = clinic?.consultation_price ?? 0

  // --- Pendientes: citas completadas de hoy y ayer SIN invoice_number ---
  const now = new Date()
  // Ayer a las 00:00 Colombia (UTC-5 → sumar 5h)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)
  // Ajustar a UTC desde Colombia (sumar 5 horas)
  const yesterdayUTC = new Date(yesterday.getTime() + 5 * 60 * 60 * 1000)

  const { data: pendingRaw } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, payment_type, clinic_value,
      patients(name),
      doctors(name)
    `)
    .eq('clinic_id', clinicId)
    .eq('status', 'completed')
    .is('invoice_number', null)
    .gte('starts_at', yesterdayUTC.toISOString())
    .order('starts_at', { ascending: true })

  const pending = (pendingRaw ?? []).map((apt) => {
    const raw = apt as Record<string, unknown>
    const patients = raw.patients as { name: string } | null
    const doctors = raw.doctors as { name: string } | null
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      patient_name: patients?.name ?? 'Sin nombre',
      doctor_name: doctors?.name ?? 'Sin doctor',
      payment_type: (apt.payment_type as string) ?? 'Particular',
      amount: (apt.clinic_value as number) || defaultPrice,
    }
  })

  // --- Facturas del mes: citas CON invoice_number en el mes actual ---
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)
  const inicioMesUTC = new Date(inicioMes.getTime() + 5 * 60 * 60 * 1000)

  const { data: invoicedRaw } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, starts_at, invoice_number, invoice_date, invoice_amount,
      payment_type, collection_status,
      patients(name)
    `)
    .eq('clinic_id', clinicId)
    .not('invoice_number', 'is', null)
    .gte('invoice_date', inicioMesUTC.toISOString().split('T')[0])
    .order('invoice_date', { ascending: false })

  const invoiced = (invoicedRaw ?? []).map((apt) => {
    const raw = apt as Record<string, unknown>
    const patients = raw.patients as { name: string } | null
    return {
      id: apt.id as string,
      starts_at: apt.starts_at as string,
      patient_name: patients?.name ?? 'Sin nombre',
      invoice_number: apt.invoice_number as string,
      invoice_date: (apt.invoice_date as string) ?? apt.starts_at as string,
      payment_type: (apt.payment_type as string) ?? 'Particular',
      invoice_amount: (apt.invoice_amount as number) || defaultPrice,
      collection_status: ((apt.collection_status as string) ?? 'en_tramite') as CollectionStatus,
    }
  })

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Facturación</h1>
        <p className="text-slate-500 text-sm">Control diario de facturas y cobros</p>
      </div>

      <FacturacionPanel
        pending={pending}
        invoiced={invoiced}
        defaultAmount={defaultPrice}
      />
    </div>
  )
}
